import {
    BigNumber,
    BitcoinWallet,
    Cnd,
    ComitClient,
    EthereumWallet,
    SwapRequest,
} from "comit-sdk";
import fs from "fs";
import moment from "moment";
import readLineSync from "readline-sync";
import { toBitcoin, toSatoshi } from "satoshi-bitcoin-ts";

(async function main() {
    checkEnvFile(process.env.DOTENV_CONFIG_PATH!);

    const maker = await startClient(0, "Maker");
    const taker = await startClient(1, "Taker");

    console.log(
        "Maker Ethereum address: ",
        await maker.ethereumWallet.getAccount()
    );

    console.log(
        "Taker Ethereum address: ",
        await taker.ethereumWallet.getAccount()
    );

    await printBalances(maker);
    await printBalances(taker);

    const swapMessage = createSwap(maker, taker);

    const takerSwapHandle = await taker.comitClient.sendSwap(swapMessage);
    await new Promise(r => setTimeout(r, 1000));
    const makerSwapHandle = await maker.comitClient
        .getNewSwaps()
        .then(swaps => swaps[0]);

    const actionConfig = { timeout: 10000, tryInterval: 1000 };
    await makerSwapHandle.accept(actionConfig);

    console.log(
        "Swap started! Swapping %d tokens @ contract address %s for %d %s",
        toNominal(swapMessage.alpha_asset.quantity, 18),
        swapMessage.alpha_asset.token_contract,
        toBitcoin(swapMessage.beta_asset.quantity),
        swapMessage.beta_asset.name
    );

    readLineSync.question("Continue?");

    console.log(
        "ERC20 contract deployed! TXID: ",
        await takerSwapHandle.deploy(actionConfig)
    );

    readLineSync.question("Continue?");

    console.log(
        "ERC20 contract funded! TXID: ",
        await takerSwapHandle.fund(actionConfig)
    );

    readLineSync.question("Continue?");

    console.log(
        "Bitcoin contract funded! TXID: ",
        await makerSwapHandle.fund(actionConfig)
    );

    readLineSync.question("Continue?");

    console.log(
        "Bitcoin redeemed! TXID: ",
        await takerSwapHandle.redeem(actionConfig)
    );

    readLineSync.question("Continue?");

    console.log(
        "ERC20 redeemed! TXID: ",
        await makerSwapHandle.redeem(actionConfig)
    );

    console.log("Swapped!");
    await printBalances(maker);
    await printBalances(taker);
    process.exit();
})();

interface Actor {
    name: string;
    comitClient: ComitClient;
    peerId: string;
    addressHint: string;
    bitcoinWallet: BitcoinWallet;
    ethereumWallet: EthereumWallet;
}

async function startClient(index: number, name: string): Promise<Actor> {
    const bitcoinWallet = await BitcoinWallet.newInstance(
        "regtest",
        process.env.BITCOIN_P2P_URI!,
        process.env[`BITCOIN_HD_KEY_${index}`]!
    );
    await new Promise(r => setTimeout(r, 1000));

    const ethereumWallet = new EthereumWallet(
        process.env.ETHEREUM_NODE_HTTP_URL!,
        process.env[`ETHEREUM_KEY_${index}`]!
    );

    const cnd = new Cnd(process.env[`HTTP_URL_CND_${index}`]!);
    const peerId = await cnd.getPeerId();
    const addressHint = await cnd
        .getPeerListenAddresses()
        .then(addresses => addresses[0]);

    const comitClient = new ComitClient(bitcoinWallet, ethereumWallet, cnd);

    return {
        name,
        comitClient,
        peerId,
        addressHint,
        bitcoinWallet,
        ethereumWallet,
    };
}

function createSwap(maker: Actor, taker: Actor): SwapRequest {
    const to = maker.peerId;
    const refundAddress = taker.ethereumWallet.getAccount();

    return {
        alpha_ledger: {
            name: "ethereum",
            network: "regtest",
        },
        beta_ledger: {
            name: "bitcoin",
            network: "regtest",
        },
        alpha_asset: {
            name: "erc20",
            token_contract: process.env.ERC20_CONTRACT_ADDRESS,
            quantity: "10000000000000000000",
        },
        beta_asset: {
            name: "bitcoin",
            quantity: toSatoshi(1).toString(),
        },
        alpha_ledger_refund_identity: refundAddress,
        alpha_expiry: moment().unix() + 7200,
        beta_expiry: moment().unix() + 3600,
        peer: {
            peer_id: to,
            address_hint: maker.addressHint,
        },
    };
}

function checkEnvFile(path: string) {
    if (!fs.existsSync(path)) {
        console.log(
            "Could not find %s file. Did you run \\`create-comit-app start-env\\`?",
            path
        );
        process.exit(1);
    }
}

async function printBalances(actor: Actor) {
    console.log(
        "%s Bitcoin balance: %d. Erc20 Token balance: %d",
        actor.name,
        parseFloat(await actor.bitcoinWallet.getBalance()).toFixed(2),
        await actor.ethereumWallet.getErc20Balance(
            process.env.ERC20_CONTRACT_ADDRESS!
        )
    );
}

function toNominal(tokenWei: string, decimals: number) {
    return new BigNumber(tokenWei).div(new BigNumber(10).pow(decimals));
}
