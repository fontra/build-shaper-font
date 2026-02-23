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
