import { HomeDocumentV2, normalizeHomeDocument } from "@/domain/home-document";
import { base64UrlToBytes, bytesToBase64Url, randomBase64Url } from "@/domain/sync-code";

const AES_KEY_LENGTH = 256;
const HKDF_INFO = "personal-homepage-sync-v1";
const IV_BYTE_LENGTH = 12;
const SALT_BYTE_LENGTH = 16;

export interface EncryptedHomeDocument {
  documentCiphertext: string;
  documentIv: string;
  documentSalt: string;
  documentSchemaVersion: number;
}

export async function encryptHomeDocument(
  documentValue: HomeDocumentV2,
  encryptionKey: string,
  documentSalt = randomBase64Url(SALT_BYTE_LENGTH)
): Promise<EncryptedHomeDocument> {
  const iv = new Uint8Array(IV_BYTE_LENGTH);
  const cryptoApi = getRequiredCrypto();
  const subtleCrypto = getRequiredSubtleCrypto(cryptoApi);
  cryptoApi.getRandomValues(iv);

  const cryptoKey = await deriveAesKey(encryptionKey, documentSalt);
  const plaintext = new TextEncoder().encode(JSON.stringify(documentValue));
  const ciphertext = await subtleCrypto.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(plaintext)
  );

  return {
    documentCiphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    documentIv: bytesToBase64Url(iv),
    documentSalt,
    documentSchemaVersion: documentValue.version
  };
}

export async function decryptHomeDocument(
  encryptedDocument: EncryptedHomeDocument,
  encryptionKey: string
): Promise<HomeDocumentV2> {
  const subtleCrypto = getRequiredSubtleCrypto();
  const cryptoKey = await deriveAesKey(encryptionKey, encryptedDocument.documentSalt);
  const plaintext = await subtleCrypto.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlToBytes(encryptedDocument.documentIv)) },
    cryptoKey,
    toArrayBuffer(base64UrlToBytes(encryptedDocument.documentCiphertext))
  );
  const decoded = new TextDecoder().decode(plaintext);

  return normalizeHomeDocument(JSON.parse(decoded));
}

async function deriveAesKey(encryptionKey: string, documentSalt: string): Promise<CryptoKey> {
  const subtleCrypto = getRequiredSubtleCrypto();
  const sourceKey = await subtleCrypto.importKey(
    "raw",
    toArrayBuffer(base64UrlToBytes(encryptionKey)),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return subtleCrypto.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(base64UrlToBytes(documentSalt)),
      info: new TextEncoder().encode(HKDF_INFO)
    },
    sourceKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getRequiredCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error(getWebCryptoUnavailableMessage());
  }

  return cryptoApi;
}

function getRequiredSubtleCrypto(cryptoApi = getRequiredCrypto()): SubtleCrypto {
  if (!cryptoApi.subtle) {
    throw new Error(getWebCryptoUnavailableMessage());
  }

  return cryptoApi.subtle;
}

function getWebCryptoUnavailableMessage(): string {
  return "当前浏览器环境不支持同步码加密。请使用 HTTPS 页面、localhost/127.0.0.1 本地页面，或支持 Web Crypto SubtleCrypto 的现代浏览器后再试。";
}
