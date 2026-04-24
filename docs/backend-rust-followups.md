# Rust Backend Follow-Ups

Deferred on purpose for this pass:

- remove Node render bridge entirely
- native Rust preview, theme preview, font specimen rendering
- deeper DaFont parser/helper split
- deeper font catalog/helper split
- provider-specific config helper split and cleanup
- OpenEPaperLink low-level HTTP/image helper split if `lib.rs` still feels too root-heavy

Reason:
- lower leverage than app-core route/service split
- bigger behavioral risk
- not required to make `main.rs` bootstrap-only and `lib.rs` stop owning app-core mutations
