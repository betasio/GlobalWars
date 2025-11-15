import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

const FALLBACK_PROJECT_NUMBER = "833972164306";

describe("verifyFirebaseTokenWithJwks", () => {
  const originalProjectNumber = process.env.FIREBASE_PROJECT_NUMBER;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    if (originalProjectNumber === undefined) {
      delete process.env.FIREBASE_PROJECT_NUMBER;
    } else {
      process.env.FIREBASE_PROJECT_NUMBER = originalProjectNumber;
    }
  });

  test("accepts numeric Firebase audience", async () => {
    jest.resetModules();
    process.env.FIREBASE_PROJECT_NUMBER = "1122334455";

    const jwtVerify = jest.fn(async (_token, _key, options) => {
      const rawAudience = options?.audience;
      const audiences = Array.isArray(rawAudience)
        ? rawAudience
        : rawAudience
          ? [rawAudience]
          : [];

      expect(audiences).toEqual(
        expect.arrayContaining([
          "globalwars-75bcf",
          "1122334455",
          FALLBACK_PROJECT_NUMBER,
        ]),
      );

      return { payload: { aud: FALLBACK_PROJECT_NUMBER } };
    });

    jest.doMock("jose", () => ({
      decodeJwt: jest.fn(),
      decodeProtectedHeader: jest.fn(() => ({ kid: "test-kid" })),
      importJWK: jest.fn(async () => ({ test: true })),
      jwtVerify,
    }));

    jest.doMock("node:https", () => ({
      get: jest.fn((_url, callback) => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        res.statusMessage = "OK";
        process.nextTick(() => {
          callback(res);
          const jwks = JSON.stringify({
            keys: [{ kid: "test-kid", alg: "RS256", kty: "RSA" }],
          });
          res.emit("data", Buffer.from(jwks));
          res.emit("end");
        });
        return { on: jest.fn() };
      }),
      request: jest.fn(() => ({
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      })),
    }));

    const { verifyFirebaseTokenWithJwks } = await import(
      "../../src/server/jwt"
    );

    const result = await verifyFirebaseTokenWithJwks("mock-token");

    expect(result).toEqual({ aud: FALLBACK_PROJECT_NUMBER });
    expect(jwtVerify).toHaveBeenCalledTimes(1);
  });
});
