[![NPM Version](https://img.shields.io/npm/v/build-shaper-font.svg)](https://npmjs.org/package/build-shaper-font)
[![Rust](https://github.com/fontra/build-shaper-font/actions/workflows/rust.yml/badge.svg)](https://github.com/fontra/build-shaper-font/actions/workflows/rust.yml)

# build-shaper-font

A minimal font compiler to produce "shaper fonts", minimal fonts to feed to HarfBuzz

## Build

You need Rust and wasm-pack installed. For example, Rust can be installed with homebrew:

```
brew install rust
```

Then install wasm-pack:

```
cargo install wasm-pack
```

Finally, build the project:

```
wasm-pack build
```

## Test

You need nodejs and npm installed. For example, they can be installed with homebrew:

```
brew install nodejs
```

Then use npm to test the project:

```
npm install
npm test
```

## Releasing

1. Update the version number in [`Cargo.toml`](./Cargo.toml)
2. Commit the change with the release number in the commit message, e.g. `git commit -a -m "0.1.6"`
3. Create a matching tag, with `v` prefix, preferably signed, e.g. `git tag -s -m "0.1.6" v0.1.6`
4. Push. Publishing to npm will happen automatically if CI build passes.
