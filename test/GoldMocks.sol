// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Gold-peg token mock. `feeBps` models PAXG's transfer fee (deducted from the amount
/// received); `noReturn` models Tether-style tokens such as XAUT whose transfer returns nothing.
contract MockGem {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public feeBps;
    bool public noReturn;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d, uint256 fee, bool nr) {
        name = n;
        symbol = s;
        decimals = d;
        feeBps = fee;
        noReturn = nr;
    }

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external {
        _move(msg.sender, to, v);
        _ret();
    }

    function transferFrom(address f, address to, uint256 v) external {
        uint256 a = allowance[f][msg.sender];
        require(a >= v, "allowance");
        if (a != type(uint256).max) allowance[f][msg.sender] = a - v;
        _move(f, to, v);
        _ret();
    }

    function _move(address f, address to, uint256 v) internal {
        require(balanceOf[f] >= v, "balance");
        uint256 fee = v * feeBps / 10000;
        balanceOf[f] -= v;
        balanceOf[to] += v - fee;
        totalSupply -= fee;
    }

    function _ret() internal view {
        if (noReturn) assembly { return(0, 0) }
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

/// Chainlink AggregatorV3 mock.
contract MockFeed {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 d, int256 a) {
        decimals = d;
        answer = a;
        updatedAt = block.timestamp;
    }

    function set(int256 a) external {
        answer = a;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
