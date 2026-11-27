// ⚠ GENERATED FROM A DEV CEREMONY (docs/zk/circom/build.sh) — FOR TESTS ONLY, NEVER DEPLOY.
// Whoever knew the setup entropy could forge proofs. See docs/ZERO_KNOWLEDGE_PROOFS.md §9.2.
// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract CompliantWithdrawVerifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 2554922571596774882445850996443007550502660260288454553862728644749488489581;
    uint256 constant alphay  = 15711464940632667257081481996551486116428753168700647705421609150767502090345;
    uint256 constant betax1  = 1459118230525546124839733940721123476334225008845521989551956086454932619210;
    uint256 constant betax2  = 15898932637208252925280871196837103267205024673047016920529341491461321294835;
    uint256 constant betay1  = 7831836067915857074164122497772202201281877869172438273640360586602803810524;
    uint256 constant betay2  = 21407175844545941030067756518870724992951903226651652158880507685713474000934;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 11101052842999366233580121479434638483792793849908006863661930673221623414665;
    uint256 constant deltax2 = 15541183998129496424712279637552823328425728937200470972618527219776183568488;
    uint256 constant deltay1 = 7778275006279441990918668333954820615612673420046015343836152086071820069639;
    uint256 constant deltay2 = 8159133793893730857566443314004916654002800455740947875923461416243572736171;

    
    uint256 constant IC0x = 12506746416608350578298359357714167011889080673432139406063617180839111212254;
    uint256 constant IC0y = 2071013141979024495887513824643119686598864939626599149537970518532730926645;
    
    uint256 constant IC1x = 13198818671226876911497323116524812488562784869490212816937279730571179307083;
    uint256 constant IC1y = 9000723855956162414941186377440245855387653358029675440767847358634969942137;
    
    uint256 constant IC2x = 13689340889663398083298148492102283540403717136252218454487745110795258093825;
    uint256 constant IC2y = 1503021827451128112364838970222315477037446872984012294311914090671630819761;
    
    uint256 constant IC3x = 17928276310184889479734490584867191997028422694302258543439075677970671277587;
    uint256 constant IC3y = 3204102034105384911099409438397100885130772316742360648634396997303906934708;
    
    uint256 constant IC4x = 9949317121455926470136497350769454729103416372853738237131874267718716256594;
    uint256 constant IC4y = 5935920473984291934397764436807579974195662971585457359302346714164722360172;
    
    uint256 constant IC5x = 17956731216777740115313406502271219119927923171644226088782264390494854001838;
    uint256 constant IC5y = 10486943452398644483685505324866472005594648281870021292508425591461250744410;
    
    uint256 constant IC6x = 1269496609891378627096433386846901594015804210232872235722397065671931971869;
    uint256 constant IC6y = 21286719035311423418565482720715269115889622065891448462638764534676723477957;
    
    uint256 constant IC7x = 21196396249320883149343450045676341883229167459453793543394317716421172012844;
    uint256 constant IC7y = 21628286507932980981583643701501425099910838224654039351858316443469744055810;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[7] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
