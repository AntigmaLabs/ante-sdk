# Contributing

## Local Setup

```bash
npm install
npm run check
```

The SDK is a standalone TypeScript package. Source files live in `src/`, tests live in `tests/`, and build output is generated in `dist/`.

## Pull Request Checklist

- Keep the public `@antigma/ante-sdk` import path stable.
- Add or update tests for protocol parsing, session lifecycle, or transport behavior.
- Run `npm run check` before opening a pull request.
- Update `CHANGELOG.md` for user-visible behavior changes.
- Do not commit `dist/`, `node_modules/`, or packed `.tgz` files.

## Release Checklist

```bash
npm run check
npm pack --dry-run
npm publish --access public
```

After publishing, update consuming repositories to the published semver range and refresh their lockfiles.
