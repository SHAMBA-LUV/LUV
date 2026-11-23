# collateral — common tasks. Requires Foundry (https://getfoundry.sh).
#   make test                       run the full suite
#   make simulate GOV=0x… SENDER=0x… ETH_RPC_URL=…   dry-run the mainnet deploy on a fork
#   make deploy   GOV=0x… SENDER=0x… ACCOUNT=<keystore> ETH_RPC_URL=…
#   make zip                        package ../collateral.zip

.PHONY: build test gas fmt simulate deploy zip clean

build:
	forge build --sizes

test:
	forge test -vv

gas:
	forge test --gas-report

fmt:
	forge fmt

simulate:
	@test -n "$(GOV)" || (echo "GOV (multisig) is required" && exit 1)
	@test -n "$(SENDER)" || (echo "SENDER (deployer address) is required" && exit 1)
	GOV=$(GOV) forge script script/DeployGoldVault.s.sol --rpc-url $(ETH_RPC_URL) --sender $(SENDER)

deploy:
	@test -n "$(GOV)" || (echo "GOV (multisig) is required" && exit 1)
	@test -n "$(SENDER)" || (echo "SENDER (deployer address) is required" && exit 1)
	@test -n "$(ACCOUNT)" || (echo "ACCOUNT (cast wallet keystore name) is required" && exit 1)
	GOV=$(GOV) forge script script/DeployGoldVault.s.sol --rpc-url $(ETH_RPC_URL) --sender $(SENDER) \
		--account $(ACCOUNT) --broadcast --verify

zip: clean
	cd .. && rm -f collateral.zip && zip -rq collateral.zip collateral -x 'collateral/out/*' 'collateral/cache/*' 'collateral/broadcast/*' 'collateral/.env'

clean:
	rm -rf out cache
