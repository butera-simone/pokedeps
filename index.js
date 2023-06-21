#!/usr/bin/env node

const fs = require('fs')
const p = require('path')
const { graphviz } = require('node-graphviz')

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    specific: 's',
    path: 'p',
    top: 't',
    graph: 'g'
  }
})

const cliHelp = `pokedeps[-p|--path directory] [-t|--top number] [-s|--specific module] [-g|--graph directory] [-h|--help]

  --path [directory] (specifies path of the project to analyze, sefault is current working directory)

  --top [number] (specifies how many of the heaviest modules to list, default is 10)

  --specific [module] (only print info about a specific module)

  --graph [directory] (creates an svg graph of the dependencies in the target directory)

  --help (prints help)
`

if (argv.t && argv.s) {
  console.log('--top cannot be used with --specific')
  process.exit(1)
}

if (argv.h) {
  console.log('Command syntax:', cliHelp)
  process.exit(1)
}

const SPECIFIC = argv.s
const PATH = argv.p
const TOP = argv.t || 10
const GRAPH = (argv.g) ? p.resolve(argv.g) : null

const moduleMap = new Map()
const folder = (PATH) ? p.resolve(PATH) : process.cwd()
const folderName = p.basename(folder)

class ObjTemplate {
  constructor (path) {
    this.ancestors = new Set()
    this.size = sizeOfDir(path)
    this.dependents = []
    this.depSize = this.size
  }
}
moduleMap.set(folderName, new ObjTemplate(folder))

function readJSONFile (filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(fileContent)
}

function sizeOfDir (path) {
  let sum = 0

  function getTotalSize (path) {
    const stats = fs.lstatSync(path)
    if (stats.isDirectory()) {
      sum += stats.size
      const list = fs.readdirSync(path)
      for (const i of list) {
        getTotalSize(`${path}/${i}`)
      }
    } else {
      sum += stats.size
    }
  }
  getTotalSize(path)
  return sum
}

function createMapEntry (parent, child, childPath) {
  if (!moduleMap.has(child)) {
    moduleMap.set(child, new ObjTemplate(childPath))
  }
  moduleMap.get(child).ancestors.add(parent)
}

function createMapOfDeps (path, module = null) {
  const target = module ? `${path}/node_modules/${module}/package.json` : `${path}/package.json`
  module = (module === null) ? folderName : module
  const obj = readJSONFile(target)
  if ('dependencies' in obj) {
    const deps = Object.keys(obj.dependencies)
    if (deps.length > 0) {
      for (const x of deps) {
        createMapEntry(module, x, `${path}/node_modules/${x}`)
        createMapOfDeps(path, x)
      }
    }
  }
}

function findPathsFromRoot (module) {
  if (module === folderName) return 'root'
  const arrayOfPaths = [[]]
  let counter = 0
  while (counter < arrayOfPaths.length) {
    const ancestors = moduleMap.get(module).ancestors
    let currentPath = arrayOfPaths[counter]
    let ancCounter = 0
    ancestors.forEach(x => {
      if (!currentPath.includes(x)) {
        if (ancCounter === 0) {
          currentPath.push(x)
          ancCounter += 1
        } else {
          arrayOfPaths.push(currentPath.slice(0, -1))
          arrayOfPaths[arrayOfPaths.length - 1].push(x)
        }
      }
    })
    if (currentPath[currentPath.length - 1] === folderName) { // reached the root, start next path
      counter += 1
      if (counter < arrayOfPaths.length) {
        currentPath = arrayOfPaths[counter]
        module = currentPath[currentPath.length - 1]
      }
    } else {
      if (ancCounter === 0) { // it was a circular path, eliminate it
        arrayOfPaths.splice(counter, counter)
      } else { // need another iteration on the same path
        module = currentPath[currentPath.length - 1]
      }
    }
  }
  return arrayOfPaths
}

function findCritical (arrayOfPaths) {
  if (arrayOfPaths === 'root') return new Set()
  const critical = new Set(arrayOfPaths[0])
  for (const x of arrayOfPaths[0]) {
    if (x === folderName) continue
    for (const y of arrayOfPaths.slice(0, -1)) {
      if (!y.includes(x)) {
        critical.delete(x)
        continue
      }
    }
  }
  return critical
}

function feedInfoToAncestors (module, criticals) {
  const size = moduleMap.get(module).size
  criticals.forEach((crit) => {
    if (crit === folderName) return
    const ref = moduleMap.get(crit)
    ref.dependents.push(module)
    ref.depSize += size
  })
}

function getModulesWeight () {
  const sizeMap = new Map()
  moduleMap.forEach((value, key) => sizeMap.set(key, value.depSize))
  const weightMap = new Map([...sizeMap.entries()].sort((a, b) => b[1] - a[1]))
  const newEntries = Array.from(weightMap, ([key, value]) =>
    `${key} : ${moduleMap.get(key).dependents.length} dependents, ${prettySize(value)} (${percentage(weightMap.get(folderName), value)}%)`
  )
  return newEntries
}

function prettySize (size) {
  return (size / 1000000).toFixed(2) + ' MB'
}

function percentage (x, y) {
  return ((y / x) * 100).toFixed(2)
}

function mapToArr () {
  const arr = []
  moduleMap.forEach(
    (value, key) => value.ancestors.forEach(
      // x => arr.push(`"${x} (${prettySize(moduleMap.get(x).depSize)})" -> "${key} (${prettySize(value.depSize)})"`)
      x => arr.push(`"${x}" -> "${key}"`)
    )
  )
  return arr
}

function arrToDot (arr) {
  return `
digraph {
    ranksep=2.5;  // Increase the vertical spacing between nodes
    sep=0.5;      // Increase the minimum space between nodes and edges

    ${arr.join(';\n    ')}
}
`
}

function main () {
  createMapOfDeps(folder)
  moduleMap.forEach((value, key) => feedInfoToAncestors(key, findCritical(findPathsFromRoot(key))))
  if (GRAPH) {
    const arrayOfDeps = mapToArr()
    const dot = arrToDot(arrayOfDeps)
    const pathToGraph = `${GRAPH}/${folderName}_deps_graph.svg`
    graphviz.dot(dot, 'svg').then((svg) => {
      // Write the SVG to file
      fs.writeFileSync(pathToGraph, svg)
    })
  }
  if (SPECIFIC) {
    const size = moduleMap.get(SPECIFIC).depSize
    console.log(`${SPECIFIC} has ${moduleMap.get(SPECIFIC).dependents.length} dependents
Cutting it would reduce size by ~${prettySize(size)}
(${percentage(moduleMap.get(folderName).depSize, size)}% of the total project size)`)
  } else {
    const arrayOfWeights = getModulesWeight()
    console.log('Top modules by total weight added to the project')
    for (let i = 1; (i <= TOP && i < arrayOfWeights.length); i++) {
      console.log(i + ') ' + arrayOfWeights[i])
    }
  }
}

main()
