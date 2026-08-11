// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * InHouse.sol — zero-dependency building blocks shared by the platform contracts.
 *
 * CLEAN HOUSE: this file replaces every third-party library import previously used by the
 * suite (Ownable, ReentrancyGuard, Pausable, SafeERC20, EIP712, ECDSA, MerkleProof). All code
 * is in-repo and auditable in one place; no submodules, no version drift, no template baggage.
 */

/// Minimal ERC-20 surface the platform needs. Works with non-standard tokens (USDT-style
/// missing return values) because callers go through SafeToken below.
interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// Single-owner access control with two-step transfer (prevents fat-finger loss of admin).
abstract contract Owned {
    address public owner;
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to; // to == 0 cancels a pending transfer
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// Irreversible. Config freezes as-is; funds already in flight keep working.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }
}

/// Gas-cheap mutex (transient-storage-free so it works on every EVM chain).
abstract contract Guarded {
    uint256 private _lock = 1;

    error Reentrant();

    modifier nonReentrant() {
        if (_lock == 2) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    // read-only reentrancy guard: a VIEW marked with this reverts if called mid-transaction (during a
    // token callback inside a nonReentrant body), so integrators can't be fed transient/inconsistent state.
    modifier whenNotEntered() {
        if (_lock == 2) revert Reentrant();
        _;
    }
}

/// Circuit breaker.
abstract contract Pausable {
    bool public paused;

    event PausedSet(bool paused);

    error IsPaused();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    function _setPaused(bool p) internal {
        paused = p;
        emit PausedSet(p);
    }
}

/// Safe ERC-20 calls tolerating tokens that return nothing (and rejecting ones returning false).
library SafeToken {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}

/// EIP-712 domain + strict ECDSA recovery (EIP-2 low-s enforced, v ∈ {27,28}, zero-signer rejected).
/// The domain separator is cached but recomputed if the chain forks to a new chainId.
abstract contract EIP712Verifier {
    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;
    bytes32 private immutable _hashedName;
    bytes32 private immutable _hashedVersion;

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    error BadSignature();

    constructor(string memory name, string memory version) {
        _hashedName = keccak256(bytes(name));
        _hashedVersion = keccak256(bytes(version));
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _hashedName, _hashedVersion, block.chainid, address(this)));
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        if (v != 27 && v != 28) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}

/// Sorted-pair Merkle proof verification (identical semantics to the OZ implementation).
library MerkleVerify {
    function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed = computed <= p
                ? keccak256(abi.encodePacked(computed, p))
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == root;
    }
}
