#!/usr/bin/env node

const fs = require('fs')
const p = require('path')
const { graphviz } = require('node-graphviz')

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    path: 'p',
    top: 't',
    dev: 'd',
    collaterals: 'c',
    specific: 's',
    graph: 'g'
  },
  boolean: ['d', 'c']
})

const cliHelp = `pokedeps[-p|--path directory] [-t|--top number] [-d|--dev] [-s|--specific module] [-g|--graph directory] [-h|--help]

  --path [directory] (specifies path of the project to analyze, default is current working directory)

  --top [number] (specifies how many of the heaviest modules to list, default is 10)

  --dev (includes dev-dependencies)

  --collaterals (sort results by number of collateral modules)

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

const PATH = argv.p
const TOP = argv.t || 10
const DEV = argv.d
const COLLATERALS = argv.c
const SPECIFIC = argv.s
const GRAPH = (argv.g) ? p.resolve(argv.g) : null

const moduleMap = new Map()
const missingSet = new Set()
const folder = (PATH) ? p.resolve(PATH) : process.cwd()
const folderName = p.basename(folder)

class ObjTemplate {
  constructor (path) {
    this.ancestors = new Set()
    this.size = sizeOfDir(path)
    this.collaterals = []
    this.depSize = this.size
  }
}
moduleMap.set(folderName, new ObjTemplate(folder))

function readJSONFile (filePath) {
  let fileContent = ''
  try {
    fileContent = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    console.log(`Target directory ${filePath} does not exist or does not have a package.json`)
    process.exit(1)
  }
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

function createMapOfDeps (path, module = null) {
  const target = module ? `${path}/node_modules/${module}/package.json` : `${path}/package.json`
  module = (module === null) ? folderName : module
  const obj = readJSONFile(target)
  let deps = []
  if ('dependencies' in obj) deps = deps.concat(Object.keys(obj.dependencies))
  if (DEV && module === folderName && 'devDependencies' in obj) deps = deps.concat(Object.keys(obj.devDependencies))
  if (deps.length > 0) {
    for (const x of deps) {
      if (!moduleMap.has(x)) {
        if (fs.existsSync(`${path}/node_modules/${x}`)) {
          moduleMap.set(x, new ObjTemplate(`${path}/node_modules/${x}`))
          moduleMap.get(x).ancestors.add(module)
          createMapOfDeps(path, x)
        } else {
          console.log(Object.keys(obj.devDependencies).length + ' ' + module + ' is missing ' + x)
          missingSet.add(x)
        }
      } else {
        moduleMap.get(x).ancestors.add(module)
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
    ref.collaterals.push(module)
    ref.depSize += size
  })
}

function getModulesWeight () {
  const totalWeight = moduleMap.get(folderName)
  const sizeMap = new Map()
  moduleMap.forEach((value, key) => sizeMap.set(key, value.depSize))
  const weightMap = new Map([...sizeMap.entries()].sort((a, b) => b[1] - a[1]))
  const newEntries = Array.from(weightMap, ([key, value]) =>
    `${key} : ${moduleMap.get(key).collaterals.length} collaterals, ${prettySize(value)} (${percentage(totalWeight, value)}%)`
  )
  return newEntries
}

function sortByCollaterals () {
  const totalWeight = moduleMap.get(folderName)
  const collateraslMap = new Map()
  moduleMap.forEach((value, key) => collateraslMap.set(key, value.collaterals.length))
  const collateraslMap2 = new Map([...collateraslMap.entries()].sort((a, b) => b[1] - a[1]))
  const newEntries = Array.from(collateraslMap2, ([key, value]) =>
    `${key} : ${value} collaterals, ${prettySize(moduleMap.get(key).depSize)} (${percentage(totalWeight, moduleMap.get(key).depSize)}%)`
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

async function main () {
  createMapOfDeps(folder)
  moduleMap.forEach((value, key) => feedInfoToAncestors(key, findCritical(findPathsFromRoot(key))))
  console.log('')
  if (GRAPH) {
    const arrayOfDeps = mapToArr()
    const dot = arrToDot(arrayOfDeps)
    const pathToGraph = DEV ? `${GRAPH}/${folderName}_depsAndDevDepsGraph.svg` : `${GRAPH}/${folderName}_depsGraph.svg`
    await graphviz.dot(dot, 'svg').then((svg) => {
      // Write the SVG to file
      try {
        fs.writeFileSync(pathToGraph, svg)
      } catch (err) {
        console.log(`The path ${pathToGraph} would require non-existing directories. Cannot create a graph there.`)
        process.exit(1)
      }
    })
  }
  if (SPECIFIC) {
    const specificTarget = moduleMap.get(SPECIFIC)
    const specificCollaterals = specificTarget.collaterals
    const size = specificTarget.depSize
    console.log(`${SPECIFIC} has ${specificCollaterals.length} collaterals ${specificCollaterals.length > 0 ? ':\n\n' + specificCollaterals.join('\n') + '\n' : ''}`)
    console.log(`Cutting it would reduce size by ~${prettySize(size)}`)
    console.log(`(${percentage(moduleMap.get(folderName).depSize, size)}% of the total project size)`)
  } else {
    const finalArray = COLLATERALS ? sortByCollaterals() : getModulesWeight()
    const firstMessage = COLLATERALS
      ? 'Top packages by number of collateral modules'
      : 'Top packages by total weight added to the project'
    console.log(firstMessage)
    for (let i = 1; (i <= TOP && i < finalArray.length); i++) {
      console.log(i + ') ' + finalArray[i])
    }
  }
  if (missingSet.size > 0) {
    console.log('')
    console.log(missingSet.size + ' dependencies not found:')
    missingSet.forEach(dep => console.log(dep))
  }

  console.log('')
}

main()
