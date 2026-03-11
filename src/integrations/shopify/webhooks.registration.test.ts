import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("./client.js", () => ({
  createShopifyClient: vi.fn(() => ({
    get: getMock,
    post: postMock,
  })),
}));

import { createShopifyClient } from "./client.js";
import { registerWebhooksAfterInstall } from "./webhooks.js";

const mockedCreateShopifyClient = vi.mocked(createShopifyClient);

describe("registerWebhooksAfterInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedCreateShopifyClient.mockReturnValue({
      get: getMock,
      post: postMock,
      graphql: vi.fn(),
    });

    getMock.mockResolvedValue({ webhooks: [] });
    postMock.mockResolvedValue({});
  });

  it("throws 400 for invalid shop domain", async () => {
    await expect(
      registerWebhooksAfterInstall({
        shop: "evil.com",
        accessToken: "token123",
        apiVersion: "2024-01",
        appUrl: "https://app.example.com",
      })
    ).rejects.toMatchObject({
      message: "Invalid shop domain",
      status: 400,
    });

    expect(mockedCreateShopifyClient).not.toHaveBeenCalled();
  });

  it("throws 400 when accessToken is missing", async () => {
    await expect(
      registerWebhooksAfterInstall({
        shop: "test-shop.myshopify.com",
        accessToken: "   ",
        apiVersion: "2024-01",
        appUrl: "https://app.example.com",
      })
    ).rejects.toMatchObject({
      message: "Missing accessToken",
      status: 400,
    });

    expect(mockedCreateShopifyClient).not.toHaveBeenCalled();
  });

  it("throws 400 when apiVersion is missing", async () => {
    await expect(
      registerWebhooksAfterInstall({
        shop: "test-shop.myshopify.com",
        accessToken: "token123",
        apiVersion: "",
        appUrl: "https://app.example.com",
      })
    ).rejects.toMatchObject({
      message: "Missing apiVersion",
      status: 400,
    });

    expect(mockedCreateShopifyClient).not.toHaveBeenCalled();
  });

  it("throws 400 when APP_URL is not https", async () => {
    await expect(
      registerWebhooksAfterInstall({
        shop: "test-shop.myshopify.com",
        accessToken: "token123",
        apiVersion: "2024-01",
        appUrl: "http://app.example.com",
      })
    ).rejects.toMatchObject({
      message: "APP_URL must be https in production",
      status: 400,
    });

    expect(mockedCreateShopifyClient).not.toHaveBeenCalled();
  });

  it("creates app/uninstalled webhook when none exists", async () => {
    getMock.mockResolvedValue({ webhooks: [] });
    postMock.mockResolvedValue({ webhook: { id: 1 } });

    const result = await registerWebhooksAfterInstall({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com",
    });

    expect(mockedCreateShopifyClient).toHaveBeenCalledWith({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token123",
    });

    expect(getMock).toHaveBeenCalledWith("/admin/api/2024-01/webhooks.json?limit=250");
    expect(postMock).toHaveBeenCalledWith("/admin/api/2024-01/webhooks.json", {
      webhook: {
        topic: "app/uninstalled",
        address: "https://app.example.com/api/shopify/webhooks",
        format: "json",
      },
    });

    expect(result).toEqual({
      ok: true,
      address: "https://app.example.com/api/shopify/webhooks",
      created: ["app/uninstalled"],
      alreadyPresent: [],
      skippedComplianceTopics: ["customers/data_request", "customers/redact", "shop/redact"],
    });
  });

  it("treats existing webhook as alreadyPresent", async () => {
    getMock.mockResolvedValue({
      webhooks: [
        {
          topic: "app/uninstalled",
          address: "https://app.example.com/api/shopify/webhooks",
        },
      ],
    });

    const result = await registerWebhooksAfterInstall({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com",
    });

    expect(postMock).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: true,
      address: "https://app.example.com/api/shopify/webhooks",
      created: [],
      alreadyPresent: ["app/uninstalled"],
      skippedComplianceTopics: ["customers/data_request", "customers/redact", "shop/redact"],
    });
  });

  it("matches existing webhook despite topic case and address formatting differences", async () => {
    getMock.mockResolvedValue({
      webhooks: [
        {
          topic: "  APP/UNINSTALLED  ",
          address: "https://app.example.com/api/shopify/webhooks/",
        },
      ],
    });

    const result = await registerWebhooksAfterInstall({
      shop: "TEST-SHOP.MYSHOPIFY.COM",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com/",
    });

    expect(mockedCreateShopifyClient).toHaveBeenCalledWith({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token123",
    });

    expect(postMock).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.alreadyPresent).toEqual(["app/uninstalled"]);
    expect(result.address).toBe("https://app.example.com/api/shopify/webhooks");
  });

  it("coerces non-array existing webhooks response to empty array", async () => {
    getMock.mockResolvedValue({ webhooks: null });
    postMock.mockResolvedValue({});

    const result = await registerWebhooksAfterInstall({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com",
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual(["app/uninstalled"]);
    expect(result.alreadyPresent).toEqual([]);
  });

  it("treats 422 duplicate error as alreadyPresent", async () => {
    getMock.mockResolvedValue({ webhooks: [] });
    postMock.mockRejectedValue({
      status: 422,
      message: "duplicate webhook",
    });

    const result = await registerWebhooksAfterInstall({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com",
    });

    expect(result.created).toEqual([]);
    expect(result.alreadyPresent).toEqual(["app/uninstalled"]);
  });

  it("treats 'already been taken' error message as alreadyPresent", async () => {
    getMock.mockResolvedValue({ webhooks: [] });
    postMock.mockRejectedValue({
      message: "Address has already been taken for this topic",
    });

    const result = await registerWebhooksAfterInstall({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://app.example.com",
    });

    expect(result.created).toEqual([]);
    expect(result.alreadyPresent).toEqual(["app/uninstalled"]);
  });

  it("rethrows unexpected post errors", async () => {
    const boom = new Error("shopify down");
    getMock.mockResolvedValue({ webhooks: [] });
    postMock.mockRejectedValue(boom);

    await expect(
      registerWebhooksAfterInstall({
        shop: "test-shop.myshopify.com",
        accessToken: "token123",
        apiVersion: "2024-01",
        appUrl: "https://app.example.com",
      })
    ).rejects.toBe(boom);
  });

  it("propagates unexpected get errors", async () => {
    const boom = new Error("get failed");
    getMock.mockRejectedValue(boom);

    await expect(
      registerWebhooksAfterInstall({
        shop: "test-shop.myshopify.com",
        accessToken: "token123",
        apiVersion: "2024-01",
        appUrl: "https://app.example.com",
      })
    ).rejects.toBe(boom);

    expect(postMock).not.toHaveBeenCalled();
  });
});