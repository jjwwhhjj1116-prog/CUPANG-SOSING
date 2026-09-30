# Live 1688 URL collection — 2026-09-30

The user-selected offer is `813724060928`. These observations come from new anonymous public HTTP requests, without accessing a Chrome profile, browser cookies, existing Couplus records or Supplier Hub quotations. They are not a Couplus backend capture.

## Observed public sources

- [PC product page](https://detail.1688.com/offer/813724060928.html): HTTP 200, 2,909 bytes during the initial diagnostic, no public Product/Offer JSON-LD. The previous JSON-LD-only collector could not obtain this product.
- [Official mobile product page](https://m.1688.com/offer/813724060928.html): HTTP 200 with a literal `window.__INIT_DATA` JSON assignment. The matching offer identity, original title, five gallery images, 24 named attributes and bounded detail reference are present. Many other page components are unloaded placeholders. Seller scripts are not executed.
- [Official SKU panel implementation](https://g.alicdn.com/code/npm/@ali/rox-wap-od-sku-panel-core/0.0.46/index.js): declares the public `mtop.mbox.fc.common.gateway` request for `wirelessCoreOdService`, `mini-od-cse`, `cbu-offer` and the selected offer ID.
- [Official public request SDK](https://g.alicdn.com/mtb/lib-mtop/2.7.4/mtop.js): declares the public client ID `12574478` and the normal MD5 request-signing/token exchange. This is not an owned 1688 OpenAPI credential. The first anonymous request returned `FAIL_SYS_TOKEN_EMPTY`; one retry with the two transport cookies issued to that same new request returned `SUCCESS::调用成功`. No login/challenge is automated, and transport values are never retained in a collection receipt or fixture.
- [Official SKU normalizer](https://g.alicdn.com/code/npm/@ali/rox-sku-core/0.0.31/index.js): distinguishes per-SKU pricing from explicitly declared common quantity tiers. A headline price or the cheapest bulk tier does not establish every SKU's unit price.
- The mobile page's exact-offer detail reference contains an HTTPS `itemcdn.tmall.com/1688offer/...` address. Its public literal `var offer_details={"content":...}` response contains eleven detail images. Only that bounded host/path is followed; JSONP or seller JavaScript is not evaluated.

## Actual collected product

Original title: 太阳眼镜木纹腿男女复古墨镜高级感潮遮阳防紫外线太阳镜复古墨镜.

| Supplier SKU | Original option | CNY unit cost | Available stock | MOQ |
|---|---|---:|---:|---:|
| 5627721589405 | 亮黑 / 太阳镜 | 3.6 | 5623 | 1 |
| 5627721589406 | 亮黑 / 太阳镜 加005 盒子 | 5.5 | 6621 | 1 |
| 5627721589409 | 砂黑 / 太阳镜 | 3.6 | 5697 | 1 |
| 5627721589410 | 砂黑 / 太阳镜 加005 盒子 | 5.5 | 6605 | 1 |
| 5627721589407 | 砂灰 / 太阳镜 | 3.6 | 5472 | 1 |
| 5627721589408 | 砂灰 / 太阳镜 加005 盒子 | 5.5 | 6360 | 1 |

The new `collectPublicProduct` entry point returned this complete validated receipt in five real requests, measured at **5,605 ms**, with eight gallery/SKU images, eleven detail images and 24 attributes. This is one observation, not a latency guarantee. The local live diagnostic used Node fetch for product/detail pages and Windows HTTP transport for the two SKU requests because this PC's direct Node connection to that host timed out. Both transports read actual responses; neither injected fixture product data. The production Worker uses its own fetch implementation; its live authenticated intake flow remains to be checked.

## Implementation and limits

The existing URL collection route now tries the official mobile source if a valid PC HTML response lacks usable JSON-LD. The existing owner-scoped receipt, category identity, editable options, margin calculation and quotation resolver handle the resulting product. Missing/ambiguous SKU identity, price, MOQ, stock, properties, conflicting product identity, private flags, malformed literal data and unbounded detail references are rejected. The shared request deadline is 30 seconds.

Product-only recorded fixtures omit seller/tracking identities and anonymous transport values. Tests cover the six SKU costs/image associations, actual placeholder shape, strict product identity, quantity-tier selection, transient handshake, cancellation, verification/access failures, and category quotation price linkage. The form linkage test uses captured category 80719 only as a synthetic resolver contract, consistent with the earlier isolated sunglasses/basket comparison; it is not a valid commercial category assignment and must never be transmitted.

The earlier Couplus observation on 2026-09-27 reported **3.42 / 5.23 CNY**, while this public source returns **3.6 / 5.5 CNY**. Do not invent a 5% discount to force parity. The cause (channel, promotion, date or collection provider) has not been confirmed. All-category defaults/official templates, SEO/image translation with live production responses, public detail HTML format and final Supplier Hub registration are separate outstanding verification items. This observation does not establish complete Couplus parity or a registered Hub quotation.
