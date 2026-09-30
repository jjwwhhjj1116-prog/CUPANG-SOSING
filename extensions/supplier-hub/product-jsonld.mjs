/** Shared public JSON-LD interpretation for the server and current-Chrome collector.
 * No seller JavaScript, credentials, remote references or guessed prices are read. */
export function parseProductJsonLd(nodes, sourceUrl) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
    const hasType = (value, type) => list(value['@type']).some(item => item === type || item === `https://schema.org/${type}` || item === `http://schema.org/${type}`);
    const required = (value, label) => { if (typeof value !== 'string' || !value.trim())
        throw Error(`${label}을 상품 페이지에서 확인하지 못했습니다.`); return value; };
    const number = value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    const offerId = value => {
        if (typeof value !== 'string' || value.length > 2048)
            throw Error('1688 상품 URL을 확인해주세요.');
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.hostname !== 'detail.1688.com' || url.port || url.username || url.password || !/^\/offer\/[1-9]\d{0,29}\.html$/.test(url.pathname))
            throw Error('1688 상품 URL을 확인해주세요.');
        return url.pathname.slice(7, -5);
    };
    const expectedOfferId = offerId(sourceUrl);
    if (!Array.isArray(nodes))
        throw Error('상품 구조화 데이터를 확인해주세요.');
    nodes = nodes.map(object);
    // Resolve only explicit, local JSON-LD references. Never fetch a referenced URL
    // or infer an offer from another product's headline price.
    // Pages sometimes emit the same JSON-LD graph in multiple script tags.
    // Byte-identical objects are one piece of evidence; distinct objects that
    // identify the same offer remain ambiguous and must still be rejected.
    const uniqueNodes = [...new Map(nodes.map(node => [JSON.stringify(node), node])).values()];
    const definitions = new Map();
    for (const node of uniqueNodes) {
        if (typeof node['@id'] !== 'string' || Object.keys(node).length === 1)
            continue;
        const id = node['@id'];
        definitions.set(id, [...(definitions.get(id) ?? []), node]);
    }
    const resolve = (value) => {
        let entry = object(value);
        const seen = new Set();
        while (typeof entry['@id'] === 'string' && Object.keys(entry).length === 1) {
            const id = entry['@id'];
            if (seen.has(id))
                throw Error('상품 페이지의 구조화된 정보 참조가 순환합니다.');
            seen.add(id);
            const matches = definitions.get(id);
            if (matches?.length !== 1)
                throw Error('상품 페이지의 구조화된 정보 참조가 없거나 중복됩니다.');
            entry = matches[0];
        }
        return entry;
    };
    // Product JSON-LD may identify its page with url, @id or
    // mainEntityOfPage. Require an explicit detail URL in one of those fields;
    // never match a product from its title, seller text or a nested SKU alone.
    const matchesSourceUrl = (value) => {
        if (typeof value !== 'string')
            return false;
        try {
            return offerId(value) === expectedOfferId;
        }
        catch {
            return false;
        }
    };
    const identifiesSource = (value) => {
        if (matchesSourceUrl(value))
            return true;
        const entry = object(value);
        if (list(entry['@id']).some(matchesSourceUrl) || list(entry.url).some(matchesSourceUrl))
            return true;
        // A WebPage reference may point at another node in the same JSON-LD graph.
        // Resolve only that local node, never a remote URL or a guessed product.
        if (Object.keys(entry).length !== 1 || typeof entry['@id'] !== 'string')
            return false;
        try {
            const page = resolve(entry);
            return page !== entry && list(page.url).some(matchesSourceUrl);
        }
        catch {
            return false;
        }
    };
    const matches = uniqueNodes.filter(node => (hasType(node, 'Product') || hasType(node, 'ProductGroup'))
        && [...list(node.url), ...list(node['@id']), ...list(node.mainEntityOfPage)].some(identifiesSource));
    if (matches.length !== 1)
        throw Error('이 URL의 상품·옵션 정보를 페이지에서 명확히 확인하지 못했습니다. 로그인 또는 페이지 수집 연결이 필요합니다.');
    const product = matches[0];
    // Preserve explicitly published product facts for the downstream SEO review.
    // Variant-specific facts must not become common facts for every SKU.
    const attributes = product.additionalProperty === undefined ? [] : list(product.additionalProperty).map(entry => {
        const property = resolve(entry);
        if (!hasType(property, 'PropertyValue'))
            throw Error('상품 속성 형식을 확인하지 못했습니다.');
        const name = required(property.name, '상품 속성명');
        const scalar = property.value;
        if (!(typeof scalar === 'string' || typeof scalar === 'boolean' || typeof scalar === 'number' && Number.isFinite(scalar)))
            throw Error('상품 속성 값을 확인하지 못했습니다.');
        const value = required(String(scalar), '상품 속성 값');
        const unit = property.unitText !== undefined ? required(property.unitText, '상품 속성 단위')
            : property.unitCode !== undefined ? required(property.unitCode, '상품 속성 단위 코드') : '';
        return { name, value: unit ? `${value} ${unit}` : value };
    });
    // Schema.org also publishes these common product facts directly, outside
    // additionalProperty. Keep conflicts as separate evidence so downstream label
    // adoption can leave ambiguous values blank. Never promote variant facts.
    for (const name of ['material', 'model']) {
        const value = product[name];
        if (typeof value !== 'string' || !value.trim())
            continue;
        if (!attributes.some(attribute => attribute.name.trim().toLowerCase() === name && attribute.value.trim() === value.trim()))
            attributes.push({ name, value });
    }
    const variants = product.hasVariant === undefined ? [product] : list(product.hasVariant).map(resolve);
    if (!variants.length || variants.length > 200)
        throw Error('옵션 1~200개를 확인해야 합니다.');
    const images = [];
    const addImages = (value) => list(value).map(item => {
        const image = typeof item === 'string' ? null : resolve(item);
        const sourceUrl = required(typeof item === 'string' ? item : image?.contentUrl ?? image?.url, '이미지 주소');
        // 1688 commonly publishes the same Alibaba CDN asset with both absolute
        // and protocol-relative URLs. Normalize before deduplication and validation.
        const url = sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl;
        let index = images.findIndex(image => image.url === url);
        if (index < 0) {
            index = images.length;
            images.push({ url, role: index === 0 ? 'main' : 'additional' });
        }
        return index;
    });
    addImages(product.image);
    const options = variants.map(variant => {
        const offers = list(variant.offers).map(resolve);
        if (offers.length !== 1 || !hasType(offers[0], 'Offer'))
            throw Error('옵션별 단일 원가를 확인하지 못했습니다. 가격 범위는 원가로 사용하지 않습니다.');
        const offer = offers[0];
        let price = offer.price, currency = offer.priceCurrency, quantity = resolve(offer.eligibleQuantity);
        if (price === undefined) {
            const specs = list(offer.priceSpecification).map(resolve);
            if (specs.length !== 1 || !hasType(specs[0], 'PriceSpecification'))
                throw Error('옵션별 단일 가격 명세를 확인하지 못했습니다.');
            const spec = specs[0];
            // Only an unqualified total price is supported, not tier/member/unit prices.
            if (Object.keys(spec).some(key => !['@id', '@type', 'price', 'priceCurrency', 'eligibleQuantity', 'valueAddedTaxIncluded'].includes(key))
                || list(spec['@type']).some(type => !['PriceSpecification', 'https://schema.org/PriceSpecification', 'http://schema.org/PriceSpecification'].includes(String(type))))
                throw Error('조건부 가격 명세는 옵션 원가로 사용할 수 없습니다.');
            if (currency !== undefined && currency !== spec.priceCurrency)
                throw Error('옵션과 가격 명세의 통화가 다릅니다.');
            price = spec.price;
            currency = spec.priceCurrency;
            if (spec.eligibleQuantity !== undefined) {
                const specified = resolve(spec.eligibleQuantity);
                if (offer.eligibleQuantity !== undefined && JSON.stringify(quantity) !== JSON.stringify(specified))
                    throw Error('옵션과 가격 명세의 최소 주문 조건이 다릅니다.');
                quantity = specified;
            }
        }
        if (currency !== 'CNY')
            throw Error('옵션 원가의 CNY 통화를 확인하지 못했습니다.');
        if (quantity.unitCode !== undefined || quantity.unitText !== undefined)
            throw Error('최소 주문 수량의 단위를 확인해야 합니다.');
        const minimumOrder = number(quantity.minValue);
        if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 1)
            throw Error('최소 주문 수량을 확인하지 못했습니다.');
        // Keep the seller's stated quantity, including zero. Availability labels and
        // ranges are not counts; weight/volume inventory cannot become piece stock.
        const inventory = resolve(offer.inventoryLevel);
        const countUnit = inventory.unitCode === undefined && inventory.unitText === undefined;
        let stock = null;
        if (hasType(inventory, 'QuantitativeValue') && countUnit && inventory.value !== undefined
            && inventory.minValue === undefined && inventory.maxValue === undefined) {
            stock = number(inventory.value);
            if (!Number.isSafeInteger(stock) || stock < 0)
                throw Error('옵션 재고 수량은 0 이상 정수여야 합니다.');
        }
        const indices = addImages(variant.image);
        return { sku: required(variant.sku ?? offer.sku, 'SKU'), name: required(variant.name, '옵션명'), unitPriceCny: number(price), minimumOrder, stock,
            ...(indices.length ? { imageIndex: indices[0] } : {}), ...(typeof variant.color === 'string' ? { color: variant.color } : {}), ...(typeof variant.size === 'string' ? { size: variant.size } : {}) };
    });
    return { title: required(product.name, '상품명'), description: product.description, options, images, ...(product.additionalProperty !== undefined || attributes.length ? { attributes } : {}) };
}
