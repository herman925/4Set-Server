/**
 * Encryption utilities for decrypting AES-GCM encrypted bundles
 * Used for credentials.enc, coreid.enc, schoolid.enc, etc.
 */
(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /**
   * Decrypt an AES-GCM encrypted bundle using a password
   * @param {ArrayBuffer} encryptedBytes - The encrypted data
   * @param {string} password - The password/passphrase to decrypt with
   * @returns {Promise<object>} - Decrypted JSON object
   * @throws {Error} - If decryption fails or password is incorrect
   */
  async function decryptBundle(encryptedBytes, password) {
    if (!password) {
      throw new Error('Password must not be empty.');
    }

    const bytes = new Uint8Array(encryptedBytes);
    const salt = bytes.slice(0, 16);
    const iv = bytes.slice(16, 28);
    const ciphertext = bytes.slice(28);

    // Derive AES key from password using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const aesKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the data
    let decrypted;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        ciphertext
      );
    } catch (error) {
      throw new Error('Incorrect password or corrupted encrypted bundle.');
    }

    // Parse as JSON
    const text = decoder.decode(decrypted);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('Decrypted data is not valid JSON.');
    }
  }

  /**
   * Load and decrypt an encrypted file
   * @param {string} path - Path to the .enc file
   * @param {string} password - The password to decrypt with
   * @returns {Promise<object>} - Decrypted JSON object
   */
  async function loadEncryptedFile(path, password) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load encrypted file: ${path} (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return decryptBundle(buffer, password);
  }

  /**
   * Load credentials.enc and validate system password
   * @param {string} systemPassword - The system password
   * @returns {Promise<object>} - Credentials object with jotformApiKey, jotformFormId, etc.
   */
  async function unlockCredentials(systemPassword) {
    const credentials = await loadEncryptedFile('assets/credentials.enc', systemPassword);
    
    // Validate that the stored systemPassword matches (if present)
    if (credentials?.systemPassword && credentials.systemPassword !== systemPassword) {
      throw new Error('System password mismatch.');
    }

    return credentials;
  }

  /**
   * Decrypt an encrypted CSV file
   * @param {ArrayBuffer} encryptedBytes - The encrypted data
   * @param {string} password - The password/passphrase to decrypt with
   * @returns {Promise<string>} - Decrypted CSV text
   */
  async function decryptCSV(encryptedBytes, password) {
    if (!password) {
      throw new Error('Password must not be empty.');
    }

    const bytes = new Uint8Array(encryptedBytes);
    const salt = bytes.slice(0, 16);
    const iv = bytes.slice(16, 28);
    const ciphertext = bytes.slice(28);

    // Derive AES key from password using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const aesKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the data
    let decrypted;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        ciphertext
      );
    } catch (error) {
      throw new Error('Incorrect password or corrupted encrypted file.');
    }

    // Return as text (CSV)
    return decoder.decode(decrypted);
  }

  /**
   * Load and decrypt an encrypted CSV file
   * @param {string} path - Path to the .enc file
   * @param {string} password - The password to decrypt with
   * @returns {Promise<string>} - Decrypted CSV text
   */
  async function loadEncryptedCSV(path, password) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load encrypted file: ${path} (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return decryptCSV(buffer, password);
  }

  // Export to global scope for use in other scripts
  window.Encryption = {
    decryptBundle,
    loadEncryptedFile,
    unlockCredentials,
    decryptCSV,
    loadEncryptedCSV
  };
})();
