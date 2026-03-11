import { describe, it, expect } from "vitest";
import { parseShop } from "./helpers.js";

describe("parseShop", () => {
  it("normalizes uppercase shop domains", () => {
    expect(parseShop({ shop: "TEST-SHOP.MYSHOPIFY.COM" })).toBe("test-shop.myshopify.com");
  });

  it("normalizes protocol-prefixed shop domains", () => {
    expect(parseShop({ shop: "https://test-shop.myshopify.com" })).toBe("test-shop.myshopify.com");
  });

  it("normalizes trailing slash shop domains", () => {
    expect(parseShop({ shop: "test-shop.myshopify.com/" })).toBe("test-shop.myshopify.com");
  });

  it("normalizes protocol + uppercase + path", () => {
    expect(parseShop({ shop: "HTTPS://TEST-SHOP.MYSHOPIFY.COM/admin/orders" })).toBe("test-shop.myshopify.com");
  });

  it("returns normalized fallback when query shop missing", () => {
    expect(parseShop({}, "TEST-SHOP.MYSHOPIFY.COM")).toBe("test-shop.myshopify.com");
  });

  it("returns empty string for invalid shop", () => {
    expect(parseShop({ shop: "not-a-shop.com" })).toBe("");
    expect(parseShop({ shop: "https://evil.com" })).toBe("");
    expect(parseShop({ shop: "abc" })).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(parseShop({ shop: "" })).toBe("");
    expect(parseShop({})).toBe("");
  });
});