# COUPLUS reference-style Free Size chart

> For agentic workers: use subagent-driven-development for focused implementation and review.

Goal: Start Work creates and connects a reference-style Free Size chart when the selected category requires a chart and no saved chart exists; the user can also seed/edit the same chart in the size workspace.

Spec: user explicitly approved COUPLUS writing rules on 2026-11-05, including Free Size and 상세페이지 참조. Ask Aside's same-offer/category comparison261105001001 generated this exact nonnumeric table and connected its PNG to quotation.

Architecture: use the existing ManualSizeChart model, document renderer and atomic size-chart-save transport, including exact readback recovery. Prefer saved actual charts/manual charts. The fallback contains no fabricated measurements, does not replace source data and does not change certificate applicability.

Table contract: sizeType='사이즈 정보', sizeUnits='none', sizes=['Free Size']; rows 사이즈=['Free Size (옵션명 또는 상세페이지 참조)'], 상세 규격=['상세페이지 참조'].

Constraints: preserve current owner/company/category/source clocks, manual option quotation-image overrides and old files; retain an immutable posted attempt across same toolbar request/remount; uncertain POST recovery is GET-only; preserve accepted886/doc2347603 and unrelated products; exclude dirtyauth.

- [x] Add shared reference-chart factory plus validation tests; no new model/provider request.
- [x] Connect required-only automatic size stage to existing atomic renderer/save; saved charts reuse, saved manual chart renders, optional category without chart skips.
- [x] Retain exact uncertain attempt and block later writes until confirmed; preflight/postread scope checks and source mismatches halt.
- [x] Add explicit Free Size seed action to existing size editor; it changes local draft only, requires existing explicit save, preserves dirty/manual inputs.
- [x] Test required/optional/saved/manual/recovery/abort/account/revision cases; independent review, build/deploy and owned socks live size-only work + quotation PNG connection.

Review focus: source chart priority; deliberate manual image overrides; no POST after uncertain ACK; scope A→B→A halts; no new price/label/legal facts or historical document writes.
