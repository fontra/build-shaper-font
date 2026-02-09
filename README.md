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

### With Node.js:

```
wasm-pack test --node
```

### With the browser:

```
WASM_BINDGEN_USE_BROWSER=1 wasm-pack test --firefox --headless
```

## Publish to NPM

```
wasm-pack publish
```
