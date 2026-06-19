// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ❤️ ShambaLuvAirdrop — the "digital gesture": 1 trillion LUV to every real new signup.
 *
 * REPLACES the original claim contract, which was SYBIL-TRIVIAL: any address could call
 * `claimAirdrop()` and pull 1T LUV, gated only by `hasClaimed[wallet]` — so one person with
 * N wallets drained it; all anti-abuse lived off-chain and was bypassable.
 *
 * This version is SIGNATURE-GATED. Our self-hosted social-login backend provisions a wallet
 * for each new social identity (Google/Apple/X/Discord/… — no thirdweb, no monthly fee) and
 * signs ONE EIP-712 claim voucher per identity. Only a voucher signed by the configured
 * `signer` can release LUV. The Sybil gate is therefore "one real social account = one claim",
 * enforced cryptographically on-chain and by identity (not by wallet) off-chain.
 *
 * Self-contained (zero imports), inline EIP-712 + ECDSA (EIP-2 malleability rejected).
 *   claim(recipient, amount, nonce, deadline, signature)
 */
contract ShambaLuvAirdrop {
    // ───────── token / config ─────────
    address public immutable token; // SHAMBA LUV
    uint256 public claimAmount = 1_000_000_000_000 * 1e18; // 1 trillion LUV per signup (the gesture)

    // Hard cap on the whole campaign: 1% of the 100-Quadrillion supply = 1 Quadrillion LUV
    // (1,000 trillion). At 1 trillion/signup that funds exactly 1,000 gestures. Enforced
    // on-chain so the giveaway can never exceed 1% even if the contract is over-funded.
    uint256 public constant AIRDROP_CAP = 1_000_000_000_000_000 * 1e18; // 1e33 base units

    address public owner; // deposits/withdraws/config (renounceable)
    address public signer; // the backend voucher key (rotatable; NOT the owner)
    bool public paused;

    mapping(uint256 => bool) public usedNonce; // one voucher per nonce (per social identity)
    mapping(address => bool) public hasClaimed; // belt-and-suspenders: one claim per wallet
    uint256 public totalClaimed;
    uint256 public claimCount;

    // ───────── EIP-712 ─────────
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)");

    // ───────── events ─────────
    event Claimed(address indexed recipient, uint256 amount, uint256 indexed nonce);
    event SignerUpdated(address indexed prev, address indexed next);
    event ClaimAmountUpdated(uint256 amount);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed prev, address indexed next);

    error NotOwner();
    error Paused();
    error Expired();
    error NonceUsed();
    error AlreadyClaimed();
    error CapReached();
    error BadSignature();
    error ZeroAddress();
    error TransferFailed();
    error Reentrant();

    uint256 private _lock = 1;
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier nonReentrant() { if (_lock == 2) revert Reentrant(); _lock = 2; _; _lock = 1; }

    constructor(address token_, address signer_) {
        if (token_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("ShambaLuvAirdrop")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ───────── the gesture: signature-gated claim ─────────
    /// Redeem a backend-signed voucher. `amount` is signed (defaults to claimAmount off-chain),
    /// `nonce` is unique per social identity, `deadline` bounds voucher lifetime.
    function claim(address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        if (paused) revert Paused();
        if (block.timestamp > deadline) revert Expired();
        if (usedNonce[nonce]) revert NonceUsed();
        if (hasClaimed[recipient]) revert AlreadyClaimed();
        if (recipient == address(0)) revert ZeroAddress();
        if (totalClaimed + amount > AIRDROP_CAP) revert CapReached(); // never exceed 1% of supply

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, recipient, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        if (_recover(digest, signature) != signer) revert BadSignature();

        usedNonce[nonce] = true;
        hasClaimed[recipient] = true;
        totalClaimed += amount;
        claimCount += 1;

        _safeTransfer(recipient, amount);
        emit Claimed(recipient, amount, nonce);
    }

    /// Off-chain helper: the exact digest the backend signs (so the server reproduces it 1:1).
    function claimDigest(address recipient, uint256 amount, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, recipient, amount, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // ───────── owner ops ─────────
    function setSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, s);
        signer = s;
    }

    function setClaimAmount(uint256 a) external onlyOwner {
        claimAmount = a;
        emit ClaimAmountUpdated(a);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// Fund the contract (owner pre-approves then deposits LUV to airdrop).
    function deposit(uint256 amount) external onlyOwner {
        if (!_pull(msg.sender, amount)) revert TransferFailed();
        emit Deposited(msg.sender, amount);
    }

    /// Recover unused LUV (or wrong tokens) — owner custody of the float.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // ───────── views ─────────
    function balance() external view returns (uint256) {
        return IERC20Min(token).balanceOf(address(this));
    }

    function remainingClaims() external view returns (uint256) {
        uint256 b = IERC20Min(token).balanceOf(address(this));
        return claimAmount == 0 ? 0 : b / claimAmount;
    }

    // ───────── internals ─────────
    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _pull(address from, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, address(this), amount));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
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
        address a = ecrecover(digest, v, r, s);
        if (a == address(0)) revert BadSignature();
        return a;
    }
}

interface IERC20Min {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
