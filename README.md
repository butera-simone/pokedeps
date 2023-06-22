# PokeDeps

Simple tool to analyze and visualize NPM dependencies, with 0 config needed.

## Usage

By default, the tool will analyze the current working directory as an NPM project and give back a list of "heaviest" modules.
The "weight" of a module is defined by how many modules are "dependent" to it (basically, which modules could be eliminated by eliminating the module, since they are only required by that module, or by modules that are only required by that module...recursively).

This is the result if you run it on [Hypercore](https://github.com/holepunchto/hypercore):

```bash
$ pokedeps
Top modules by total weight added to the project
1) sodium-universal : 12 dependents, 5.42 MB (11.45%)
2) sodium-native : 1 dependents, 4.65 MB (9.82%)
3) blake2b : 1 dependents, 0.44 MB (0.93%)
4) @hyperswarm/secret-stream : 7 dependents, 0.22 MB (0.46%)
5) blake2b-wasm : 0 dependents, 0.13 MB (0.27%)
6) events : 0 dependents, 0.10 MB (0.20%)
7) sodium-javascript : 0 dependents, 0.10 MB (0.20%)
8) compact-encoding : 0 dependents, 0.06 MB (0.13%)
9) streamx : 1 dependents, 0.06 MB (0.12%)
10) xsalsa20 : 0 dependents, 0.05 MB (0.11%)
```

You can run `pokedeps --help` to get

```
pokedeps[-p|--path directory] [-t|--top number] [-s|--specific module] [-g|--graph directory] [-h|--help]

  --path [directory] (specifies path of the project to analyze, default is current working directory)

  --top [number] (specifies how many of the heaviest modules to list, default is 10)

  --specific [module] (only print info about a specific module)

  --graph [directory] (creates an svg graph of the dependencies in the target directory)

  --help (prints help)
```

Get info about the 15 heaviest modules in project X:

```bash
pokedeps -t 15 -p path/to/X
```

Also generate a graph of dependencies using Graphviz:

```bash
pokedeps -t 15 -p path/to/X -g path/to/folder/that/will/contain/graph
```

## License

This project is licensed under the Apache 2.0 license.
