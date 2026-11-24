// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldGuardian — the emergency brake (a minimal Maker ESM).
 *
 * It is a ward of GoldVault but exposes exactly ONE power: cage(). The owner (the GOV
 * multisig) can therefore shut the system down instantly in an emergency, while every other
 * governance action still has to wait out GoldTimelock's delay. Shutdown can only freeze the
 * system and hand collateral back to its owners and bXAU holders; it cannot move funds
 * anywhere else.
 */
interface ICageable {
    function cage() external;
}

contract GoldGuardian {
    ICageable public immutable vault;
    address public owner;

    event OwnershipTransferred(address indexed from, address indexed to);
    event Fired(address indexed by);

    error NotOwner();

    constructor(address vault_, address owner_) {
        vault = ICageable(vault_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function fire() external {
        if (msg.sender != owner) revert NotOwner();
        emit Fired(msg.sender);
        vault.cage();
    }
}
