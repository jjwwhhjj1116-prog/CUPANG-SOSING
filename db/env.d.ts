declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    SUPPLIER_HUB_ENDPOINT?: string;
    SUPPLIER_HUB_API_KEY?: string;
  }
}
