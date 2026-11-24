// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldTimelock — governance delay for the gold basket (Maker's DSPause, simplified).
 *
 * The admin (the GOV multisig) can only SCHEDULE calls; anyone can EXECUTE them once `delay`
 * has passed, within GRACE. Every governance power over GoldVault (risk params, spotter swap,
 * flap, …), over PegSpotter and over GoldFlash therefore becomes public `delay` seconds before
 * it takes effect, giving users time to exit.
 *
 * The delay and the admin can only be changed by the timelock itself, i.e. through the same
 * schedule → wait → execute path. Emergency shutdown does not wait: see GoldGuardian.
 */
contract GoldTimelock {
    uint256 public constant GRACE = 14 days;
    uint256 public constant MAX_DELAY = 30 days;

    address public admin;
    uint256 public delay;
    mapping(bytes32 => bool) public queued;

    event Schedule(bytes32 indexed id, address indexed target, uint256 value, bytes data, uint256 eta);
    event Cancel(bytes32 indexed id);
    event Execute(bytes32 indexed id, address indexed target, uint256 value, bytes data, uint256 eta);
    event SetAdmin(address admin);
    event SetDelay(uint256 delay);

    error NotAdmin();
    error NotSelf();
    error BadDelay();
    error EtaTooSoon();
    error NotQueued();
    error NotReady();
    error Expired();
    error CallFailed(bytes reason);

    constructor(address admin_, uint256 delay_) {
        if (delay_ > MAX_DELAY) revert BadDelay();
        admin = admin_;
        delay = delay_;
        emit SetAdmin(admin_);
        emit SetDelay(delay_);
    }

    receive() external payable {}

    function hashOf(address target, uint256 value, bytes calldata data, uint256 eta) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, eta));
    }

    function schedule(address target, uint256 value, bytes calldata data, uint256 eta) external returns (bytes32 id) {
        if (msg.sender != admin) revert NotAdmin();
        if (eta < block.timestamp + delay) revert EtaTooSoon();
        id = hashOf(target, value, data, eta);
        queued[id] = true;
        emit Schedule(id, target, value, data, eta);
    }

    function cancel(address target, uint256 value, bytes calldata data, uint256 eta) external {
        if (msg.sender != admin) revert NotAdmin();
        bytes32 id = hashOf(target, value, data, eta);
        if (!queued[id]) revert NotQueued();
        delete queued[id];
        emit Cancel(id);
    }

    /// Permissionless once the delay has passed.
    function execute(address target, uint256 value, bytes calldata data, uint256 eta)
        external
        payable
        returns (bytes memory ret)
    {
        bytes32 id = hashOf(target, value, data, eta);
        if (!queued[id]) revert NotQueued();
        if (block.timestamp < eta) revert NotReady();
        if (block.timestamp > eta + GRACE) revert Expired();
        delete queued[id];
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        emit Execute(id, target, value, data, eta);
    }

    function setAdmin(address admin_) external {
        if (msg.sender != address(this)) revert NotSelf();
        admin = admin_;
        emit SetAdmin(admin_);
    }

    function setDelay(uint256 delay_) external {
        if (msg.sender != address(this)) revert NotSelf();
        if (delay_ > MAX_DELAY) revert BadDelay();
        delay = delay_;
        emit SetDelay(delay_);
    }
}
