[![NPM Version](https://img.shields.io/npm/v/build-shaper-font.svg)](https://npmjs.org/package/build-shaper-font)
[![Rust](https://github.com/fontra/build-shaper-font/actions/workflows/rust.yml/badge.svg)](https://github.com/fontra/build-shaper-font/actions/workflows/rust.yml)

# build-shaper-font

A minimal font compiler to produce "shaper fonts", minimal fonts to feed to HarfBuzz

## Build

### Prerequisites

- Rust
- wasm-pack

E.g. with homebrew:

```
brew install rust
brew install wasm-pack
```

### For Node.js:

```
wasm-pack build --target nodejs
```

### For the browser:

```
wasm-pack build --target web
```

## Test

```
npm install
npm test
```

## Publish to NPM

```
wasm-pack publish
```
