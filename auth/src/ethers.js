'use strict';

/*
 * ethers.js — clean-room loader for ethers v6.
 *
 * Per the DeltaVerse clean-room / no-CDN policy, we prefer the repo's VENDORED ethers UMD
 * (../../../vendor/ethers.umd.min.js, v6.16.0) so the backend has zero remote dependency for
 * its cryptography. If the vendored bundle is not reachable (e.g. running this folder in
 * isolation), we fall back to the npm `ethers` dependency declared in package.json.
 *
 * Either path yields the same ethers v6 API (Wallet, JsonRpcProvider, Contract,
 * verifyTypedData, etc.).
 */

const path = require('path');

let ethers;

function normalize(mod) {
  // UMD bundle may export the namespace directly or under `.ethers`.
  if (mod && mod.Wallet) return mod;
  if (mod && mod.ethers && mod.ethers.Wallet) return mod.ethers;
  return mod;
}

const VENDOR_PATH = path.resolve(__dirname, '../../../vendor/ethers.umd.min.js');

try {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  ethers = normalize(require(VENDOR_PATH));
  if (!ethers || !ethers.Wallet) throw new Error('vendored ethers missing Wallet');
} catch (vendorErr) {
  try {
    // eslint-disable-next-line global-require
    ethers = normalize(require('ethers'));
  } catch (npmErr) {
    throw new Error(
      'Could not load ethers from vendored bundle (' +
        VENDOR_PATH +
        ') nor from npm `ethers`. Install deps (`npm i`) or restore the vendored bundle. ' +
        'vendor error: ' +
        vendorErr.message +
        ' | npm error: ' +
        npmErr.message
    );
  }
}

module.exports = ethers;
