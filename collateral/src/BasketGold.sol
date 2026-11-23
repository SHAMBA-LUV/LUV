// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * BasketGold (bXAU) — the debt token of the gold basket CDP system (MakerDAO-style "Dai").
 *
 * 1 bXAU is a claim worth one fine troy ounce of gold. It is minted only by GoldVault
 * against over-collateralised positions in existing on-chain gold pegs (PAXG, XAUT, …)
 * and burned when those positions are repaid or liquidated.
 *
 * Self-contained (zero imports). Mint/burn are restricted to `wards` (Maker naming): after
 * deployment the deployer relies the vault and denies itself, leaving the vault as the only
 * minter.
 */
contract BasketGold {
    string public constant name = "Basket Gold";
    string public constant symbol = "bXAU";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public wards;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Rely(address indexed usr);
    event Deny(address indexed usr);

    error NotAuthorized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    modifier auth() {
        if (wards[msg.sender] != 1) revert NotAuthorized();
        _;
    }

    constructor() {
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
    }

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(usr);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(usr);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _spend(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external auth {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    /// Burn `value` from `from`. A ward burning anyone else's balance needs their allowance,
    /// so users approve the vault before wipe / liquidate / cash (exactly like Maker's DaiJoin).
    function burn(address from, uint256 value) external auth {
        if (from != msg.sender) _spend(from, msg.sender, value);
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function _spend(address owner, address spender, uint256 value) internal {
        uint256 a = allowance[owner][spender];
        if (a != type(uint256).max) {
            if (a < value) revert InsufficientAllowance();
            unchecked {
                allowance[owner][spender] = a - value;
            }
        }
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
