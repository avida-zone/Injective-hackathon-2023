import {
  MsgBroadcasterWithPk,
  MsgExecuteContract,
  PrivateKey,
} from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { accounts } from "../accounts";
import {
  ContractsInterface,
  QueryService,
  WalletPlugin,
  toCosmosMsg,
  generateProof,
} from "../utils";
import { ExecuteMsg as LaunchPadMsg } from "../interfaces/Launchpad.types";
import {
  BalanceResponse,
  ExecuteMsg as RgCw20ExecMsg,
} from "../interfaces/RgCw20.types";
import { ProxyT } from "@vectis/types";

describe("Transform inj to rgInj and back: ", () => {
  let privateKey;
  let network;
  let endpoints;
  let client: MsgBroadcasterWithPk;
  let userAddr: string;
  let qs: QueryService;
  let launchpad: string;
  let wallet: string;
  let rg1_transform_addr: string;
  let adaptAmount: string;
  let mintAmount: string;

  beforeAll(async () => {
    userAddr = accounts.user.address;
    privateKey = PrivateKey.fromMnemonic(accounts.user.mnemonic);
    network = Network.Testnet;
    endpoints = getNetworkEndpoints(network);
    client = new MsgBroadcasterWithPk({
      privateKey,
      network,
      simulateTx: true,
    });
    qs = new QueryService(network, endpoints);

    let contracts = (await import(
      "../deploy/injective-testnet-deployInfo.json"
    )) as ContractsInterface;
    launchpad = contracts.launchpad;

    let walletAddrs = (await import(
      "../deploy/plugin_account.json"
    )) as WalletPlugin;
    wallet = walletAddrs.wallet;

    let transform_token = await import("../deploy/rg1_transform_address.json");
    rg1_transform_addr = transform_token.default;
    mintAmount = "30";
  });

  it("should not able to transform token with wrong proof", async () => {
    const initNonce: string = await qs.queryWasm(rg1_transform_addr, {
      proof_nonce: { address: wallet },
    });

    const notNonce = (+initNonce + 10).toString();
    let proof = await generateProof(userAddr, wallet, notNonce);

    let transform_msg: LaunchPadMsg = {
      transform: {
        proof,
        rg_token_addr: rg1_transform_addr,
      },
    };

    let proxy_msg: ProxyT.CosmosMsgForEmpty = {
      wasm: {
        execute: {
          contract_addr: launchpad,
          funds: [{ denom: "inj", amount: mintAmount }],
          msg: toCosmosMsg(transform_msg),
        },
      },
    };

    let mint = MsgExecuteContract.fromJSON({
      contractAddress: wallet,
      sender: userAddr,
      msg: { execute: { msgs: [proxy_msg] } },
      funds: { denom: "inj", amount: mintAmount },
    });

    await expect(
      client.broadcast({
        msgs: mint,
        injectiveAddress: userAddr,
      })
    ).rejects.toThrowError();
  });

  it("should be able to tranform to RG token", async () => {
    const initNonce: string = await qs.queryWasm(rg1_transform_addr, {
      proof_nonce: { address: wallet },
    });
    const initRgBalance: BalanceResponse = await qs.queryWasm(
      rg1_transform_addr,
      {
        balance: { address: wallet },
      }
    );
    const initTfBalance = await qs.queryBalance(wallet, "inj");

    let proof = await generateProof(userAddr, wallet, initNonce);

    let transform_msg: LaunchPadMsg = {
      transform: {
        proof,
        rg_token_addr: rg1_transform_addr,
      },
    };

    let proxy_msg: ProxyT.CosmosMsgForEmpty = {
      wasm: {
        execute: {
          contract_addr: rg1_transform_addr,
          funds: [{ denom: "inj", amount: mintAmount }],
          msg: toCosmosMsg(transform_msg),
        },
      },
    };

    let adapt = MsgExecuteContract.fromJSON({
      contractAddress: wallet,
      sender: userAddr,
      msg: { execute: { msgs: [proxy_msg] } },
    });

    await client.broadcast({
      msgs: adapt,
      injectiveAddress: userAddr,
    });

    const afterNonce: string = await qs.queryWasm(rg1_transform_addr, {
      proof_nonce: { address: wallet },
    });
    const afterRgBalance: BalanceResponse = await qs.queryWasm(
      rg1_transform_addr,
      {
        balance: { address: wallet },
      }
    );
    const afterTfBalance = await qs.queryBalance(wallet, "inj");

    expect(+afterNonce).toEqual(+initNonce + 1);
    expect(+afterRgBalance.balance).toEqual(
      +initRgBalance.balance - +adaptAmount
    );
    expect(+afterTfBalance).toEqual(+initTfBalance + +adaptAmount);
  });

  it("should be able to revert transform token", async () => {
    let nonce: string = await qs.queryWasm(rg1_transform_addr, {
      proof_nonce: { address: wallet },
    });
    let proof = await generateProof(userAddr, wallet, nonce);
    const initRgBalance: BalanceResponse = await qs.queryWasm(
      rg1_transform_addr,
      {
        balance: { address: wallet },
      }
    );
    const initTfBalance = await qs.queryBalance(wallet, "inj");

    let revert_msg: RgCw20ExecMsg = {
      burn: {
        amount: mintAmount,
        proof,
      },
    };

    let proxy_msg: ProxyT.CosmosMsgForEmpty = {
      wasm: {
        execute: {
          contract_addr: rg1_transform_addr,
          funds: [],
          msg: toCosmosMsg(revert_msg),
        },
      },
    };

    let revert = MsgExecuteContract.fromJSON({
      contractAddress: wallet,
      sender: userAddr,
      msg: { execute: { msgs: [proxy_msg] } },
    });

    await client.broadcast({
      msgs: revert,
      injectiveAddress: userAddr,
    });

    const afterRgBalance: BalanceResponse = await qs.queryWasm(
      rg1_transform_addr,
      {
        balance: { address: wallet },
      }
    );
    const afterTfBalance = await qs.queryBalance(wallet, "inj");

    expect(+afterRgBalance.balance).toEqual(
      +initRgBalance.balance + +adaptAmount
    );
    expect(+afterTfBalance).toEqual(+initTfBalance - +adaptAmount);
  });
});
