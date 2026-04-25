# InkFrame Studio

InkFrame Studio is a Rust-backed, Lit-based editor for OpenEPaperLink and other e-paper display systems.

Important shape:
- Frontend lives in `packages/editor-ui`.
- Shared renderer/types live in `packages/render-core`.
- Backend lives in `rust/backend-api`.
- Native text shaping lives in `rust/text-engine`.
- Home Assistant add-on files live in `addon`.
- Built editor assets are embedded into the Rust binary with `rust-embed`.
- `just run` must build editor assets, compile backend, and run the binary. Runtime UI must come from the binary, not loose web files.

Build/test:
- Run shell commands through `rtk`.
- Prefer `rg`/`rg --files`.
- Before release, run:
  - `npm run typecheck`
  - `npm test -- packages/editor-ui/src/app.test.ts`
  - `cargo test -p epd-backend-api` from `rust/`
  - `npm run build`

Home Assistant add-on:
- Repository metadata is root `repository.yaml`.
- Add-on metadata is `addon/config.yaml`.
- Add-on image is `ghcr.io/tader/inkframestudio`.
- Docker builds use Home Assistant base `3.21` images plus official rustup stable. Do not rely on Alpine `cargo`/`rust` packages; HA base Rust versions lag crates that require newer MSRV. HA base `3.22` is not available for all add-on arch images yet.
- Release image workflow is `.github/workflows/addon-images.yml`.
- GHCR package must be public for Home Assistant installs.

Release instructions:
1. Pick next semver version.
2. Update:
   - `package.json`
   - `package-lock.json`
   - `addon/config.yaml`
   - `rust/backend-api/Cargo.toml`
   - `rust/text-engine/Cargo.toml`
   - `rust/Cargo.lock`
   - `rust/text-engine/Cargo.lock`
3. Run release checks listed above.
4. Commit with message like `Release vX.Y.Z` or a focused patch message.
5. Create annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
6. Push `main` and tag: `git push origin main && git push origin vX.Y.Z`.
7. Confirm GitHub Actions builds and publishes add-on images for all configured architectures.
