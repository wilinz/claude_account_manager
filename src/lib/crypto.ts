import { EXPORT_FORMAT, EXPORT_VERSION, EncryptedBundle, ExportBundle } from '@/types'

/**
 * 导出加密：PBKDF2-SHA256 派生密钥 + AES-GCM-256。
 * 每次导出都用新的随机 salt 和 iv，同一份数据两次导出的密文不同。
 */
const PBKDF2_ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  // 分块，避免大数组撑爆 String.fromCharCode 的参数上限
  const chunk = 0x8000
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBundle(
  bundle: ExportBundle,
  password: string,
): Promise<EncryptedBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext,
  )

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    encrypted: true,
    exportedAt: bundle.exportedAt,
    accountCount: bundle.accounts.length,
    warning: '本文件已用密码加密（PBKDF2-SHA256 + AES-GCM-256）。丢失密码无法恢复。',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    payload: toBase64(ciphertext),
  }
}

export function isEncryptedBundle(raw: unknown): raw is EncryptedBundle {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { encrypted?: unknown }).encrypted === true &&
    typeof (raw as { payload?: unknown }).payload === 'string'
  )
}

/** 解密后返回原始 JSON 对象，交给 parseBundle 做结构校验 */
export async function decryptBundle(
  bundle: EncryptedBundle,
  password: string,
): Promise<unknown> {
  if (bundle.cipher?.name !== 'AES-GCM' || bundle.kdf?.name !== 'PBKDF2') {
    throw new Error('不支持的加密算法，可能来自更新版本的扩展')
  }
  const salt = fromBase64(bundle.kdf.salt)
  const iv = fromBase64(bundle.cipher.iv)
  const iterations = bundle.kdf.iterations || PBKDF2_ITERATIONS
  const key = await deriveKey(password, salt, iterations)

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      fromBase64(bundle.payload) as BufferSource,
    )
  } catch {
    // AES-GCM 认证失败：密码错，或文件被改过
    throw new Error('密码错误，或文件已损坏')
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new Error('解密成功但内容不是合法 JSON')
  }
}
