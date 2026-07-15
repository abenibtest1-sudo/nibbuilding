import crypto from "crypto";

const IV = "0123456789abcdef";
const BLOCK_SIZE = 16;

function getKey(): string {
  const key = process.env.YAGOUTPAY_ENCRYPTION_KEY;
  if (!key) throw new Error("YAGOUTPAY_ENCRYPTION_KEY is not configured.");
  return key;
}

/** AES-256-CBC encrypt, PKCS-style zero/byte padding matching Yagout's PHP sample */
export function yagoutEncrypt(text: string, key: string = getKey()): string {
  const keyBuf = Buffer.from(key, "base64");
  const ivBuf = Buffer.from(IV, "utf8");
  const textBuf = Buffer.from(text, "utf8");

  const pad = BLOCK_SIZE - (textBuf.length % BLOCK_SIZE);
  const padded = Buffer.concat([textBuf, Buffer.alloc(pad, pad)]);

  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

  return encrypted.toString("base64");
}

/** AES-256-CBC decrypt, stripping the same padding scheme */
export function yagoutDecrypt(cipherB64: string, key: string = getKey()): string {
  const keyBuf = Buffer.from(key, "base64");
  const ivBuf = Buffer.from(IV, "utf8");
  const encrypted = Buffer.from(cipherB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuf, ivBuf);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  const padLen = decrypted[decrypted.length - 1];
  if (padLen > 0 && padLen <= BLOCK_SIZE) {
    return decrypted.subarray(0, decrypted.length - padLen).toString("utf8");
  }
     console.log("################ YAGOUT CALLBACK decrypted #################");
    console.log(JSON.stringify(decrypted, null, 2)); 
    console.log("#######################################################");
  return decrypted.toString("utf8");
}

/** hash = AES-encrypt( sha256_hex(merchant_id~order_no~amount~country~currency) ) */
export function yagoutHash(params: {
  merchantId: string;
  orderNo: string;
  amount: string;
  country: string;
  currency: string;
}): string {
  const raw = [
    params.merchantId,
    params.orderNo,
    params.amount,
    params.country,
    params.currency,
  ].join("~");
  const sha256Hex = crypto.createHash("sha256").update(raw).digest("hex");
  return yagoutEncrypt(sha256Hex);
}

const pipe = (fields: (string | number)[]) => fields.map((f) => (f ?? "").toString()).join("|");

export interface YagoutTxnDetails {
  agId: string;
  meId: string;
  orderNo: string;
  amount: string; // "150.00"
  country: string; // "ETH"
  currency: string; // "ETB"
  txnType: string; // "SALE"
  successUrl: string;
  failureUrl: string;
  channel: string; // "WEB" | "MOBILE"
}

export interface YagoutCustDetails {
  custName?: string;
  emailId: string;
  mobileNo: string;
  uniqueId?: string;
  isLoggedIn: "Y" | "N";
}

export interface YagoutBillDetails {
  billAddress?: string;
  billCity?: string;
  billState?: string;
  billCountry?: string;
  billZip?: string;
}


export function verifyYagoutHash(
  encryptedHash: string,
  params: { merchantId: string; orderNo: string; amount: string; country: string; currency: string },
): boolean {
  try {
    const decryptedHash = yagoutDecrypt(encryptedHash);
    const raw = [params.merchantId, params.orderNo, params.amount, params.country, params.currency].join("~");
    const expectedHash = crypto.createHash("sha256").update(raw).digest("hex");
    console.log("################ YAGOUT CALLBACK expectedHash #################");
    console.log(JSON.stringify(expectedHash, null, 2)); 
    console.log(JSON.stringify(decryptedHash === expectedHash, null, 2)); 
    console.log("#######################################################");
    return decryptedHash === expectedHash;
  } catch (err) {
    console.error("YagoutPay: failed to verify callback hash.", err);
    return false;
  }
}

/** Decrypts a field if present and non-empty; returns null otherwise (never throws on blank fields) */
export function safeDecrypt(value: FormDataEntryValue | null | undefined): string | null {
  if (!value || typeof value !== "string" || value.trim() === "") return null;
  try {
    
    return yagoutDecrypt(value);
    
  } catch (err) {
    console.error("YagoutPay: failed to decrypt callback field.", err);
    return null;
  }
}

export interface YagoutPgDetails {
  pgId: string;
  pgName: string;
  paymode: string;
}

export function parsePgDetails(decrypted: string): YagoutPgDetails {
  const [pgId, pgName, paymode] = decrypted.split("|");
   console.log("################ YAGOUT CALLBACK expectedHash #################");
    console.log(pgId, pgName, paymode); 
    console.log("#######################################################");
  return { pgId, pgName, paymode };
}

/**
 * Builds the full merchant_request string per the documented section order:
 * txn_details ~ pg_details ~ card_details ~ cust_details ~ bill_details
 * ~ ship_details ~ item_details ~ upi_details ~ other_details
 */
export function buildMerchantRequestPlaintext(input: {
  txn: any;
  cust: any;
  udf1?: string; // Add this
}): string {
  const { txn, cust, udf1 } = input;

  const txnSection = pipe([txn.agId, txn.meId, txn.orderNo, txn.amount, txn.country, txn.currency, txn.txnType, txn.successUrl, txn.failureUrl, txn.channel]);
  const pgSection = pipe(["", "", "", ""]); 
  const cardSection = pipe(["", "", "", "", ""]);
  const custSection = pipe([cust.custName ?? "", cust.emailId, cust.mobileNo, "", cust.isLoggedIn]);
  const billSection = pipe(["", "", "", "", ""]);
  const shipSection = pipe(["", "", "", "", "", "", ""]);
  const itemSection = pipe(["", "", ""]);
  const upiSection = pipe([""]);
  
  // --- UPDATED OTHER SECTION ---
  const otherSection = pipe([udf1 ?? "", "", "", "", ""]); 

  return [txnSection, pgSection, cardSection, custSection, billSection, shipSection, itemSection, upiSection, otherSection].join("~");
}

/** Parsed shape of the decrypted txn_response segment posted back by Yagout */
export interface YagoutTxnResponse {
  agId: string;
  meId: string;
  orderNo: string;
  amount: string;
  country: string;
  currency: string;
  txnDate: string;
  txnTime: string;
  agRef: string;
  pgRef: string;
  status: string; // "Successful" | "Failed" | ...
  resCode: string;
  resMessage: string;
}

export function parseTxnResponse(decrypted: string): YagoutTxnResponse {
  const [
    agId, meId, orderNo, amount, country, currency,
    txnDate, txnTime, agRef, pgRef, status, resCode, resMessage,
  ] = decrypted.split("|");
  return { agId, meId, orderNo, amount, country, currency, txnDate, txnTime, agRef, pgRef, status, resCode, resMessage };
}