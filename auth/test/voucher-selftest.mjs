/*
 * voucher-selftest.mjs — prove the EIP-712 voucher this backend signs matches what the
 * ShambaLuvAirdrop contract's _recover expects.
 *
 * It builds a Claim voucher with a KNOWN private key, signs it with ethers
 * signTypedData(domain, types, value), then recovers the signer with verifyTypedData and
 * asserts it equals the signer address — exactly the check the on-chain contract performs
 * (digest = "\x19\x01" || DOMAIN_SEPARATOR || structHash; ecrecover == signer).
 *
 * It also recomputes the digest manually via TypedDataEncoder.hash(...) and confirms the
 * domain name/version/type string byte-match the contract source.
 *
 * Run: node test/voucher-selftest.mjs   (uses the repo's vendored ethers; falls back to npm)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load ethers via the same loader the server uses (vendored UMD, else npm).
const ethers = require('../src/ethers.js');
const { buildDomain, buildClaimValue, CLAIM_TYPES, EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } =
  require('../src/eip712.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  -', msg);
}

async function main() {
  // Known voucher signer key (test-only; NOT a real secret).
  const VOUCHER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const signer = new ethers.Wallet(VOUCHER_PK);
  const signerAddress = await signer.getAddress();

  // Pretend-deployed airdrop on chain 1.
  const chainId = 1;
  const verifyingContract = '0x1111111111111111111111111111111111111111';
  const recipient = '0x2222222222222222222222222222222222222222';
  const amount = 1000000000000000000000000000000n; // 1e30 = 1 trillion LUV
  const nonce = 0x1234567890abcdefn;
  const deadline = 1893456000n; // some future unix ts

  const domain = buildDomain({ chainId, verifyingContract });
  const value = buildClaimValue({ recipient, amount, nonce, deadline });

  // 1) domain + type string byte-match the contract.
  assert(domain.name === EIP712_DOMAIN_NAME && domain.name === 'ShambaLuvAirdrop',
    'domain name == "ShambaLuvAirdrop"');
  assert(domain.version === EIP712_DOMAIN_VERSION && domain.version === '1',
    'domain version == "1"');

  // Reconstruct the exact type string the contract hashes for CLAIM_TYPEHASH.
  const typeString = 'Claim(' +
    CLAIM_TYPES.Claim.map((f) => `${f.type} ${f.name}`).join(',') + ')';
  assert(typeString === 'Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)',
    'Claim type string matches contract CLAIM_TYPEHASH preimage');

  // 2) sign, then recover — the heart of the on-chain check.
  const signature = await signer.signTypedData(domain, CLAIM_TYPES, value);
  const recovered = ethers.verifyTypedData(domain, CLAIM_TYPES, value, signature);
  assert(recovered.toLowerCase() === signerAddress.toLowerCase(),
    `verifyTypedData recovers the voucher signer (${signerAddress})`);

  // 3) reproduce the digest the contract builds and confirm it's a 32-byte hash.
  const digest = ethers.TypedDataEncoder.hash(domain, CLAIM_TYPES, value);
  assert(/^0x[0-9a-fA-F]{64}$/.test(digest), `EIP-712 digest is 32 bytes: ${digest}`);

  // 4) Independently recompute DOMAIN_SEPARATOR exactly as the Solidity constructor does and
  //    confirm ethers uses the same domain separator inside its digest.
  const EIP712_DOMAIN_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  );
  const domainSeparator = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        EIP712_DOMAIN_TYPEHASH,
        ethers.keccak256(ethers.toUtf8Bytes('ShambaLuvAirdrop')),
        ethers.keccak256(ethers.toUtf8Bytes('1')),
        chainId,
        verifyingContract,
      ]
    )
  );
  const ethersDomainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
  assert(domainSeparator === ethersDomainSeparator,
    'manual Solidity-style DOMAIN_SEPARATOR == ethers hashDomain');

  // 5) reproduce structHash + final digest like the contract and compare to ethers digest.
  const CLAIM_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(typeString));
  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'address', 'uint256', 'uint256', 'uint256'],
      [CLAIM_TYPEHASH, recipient, amount, nonce, deadline]
    )
  );
  const manualDigest = ethers.keccak256(
    ethers.concat(['0x1901', domainSeparator, structHash])
  );
  assert(manualDigest === digest,
    'manual Solidity-style digest ("\\x19\\x01"||DS||structHash) == ethers digest');

  console.log('\nALL CHECKS PASSED — the backend voucher byte-matches ShambaLuvAirdrop.sol.');
}

main().catch((err) => {
  console.error('selftest error:', err);
  process.exit(1);
});
