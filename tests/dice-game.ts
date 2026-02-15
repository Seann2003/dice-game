import { LiteSVMProvider, fromWorkspace } from "anchor-litesvm";
import { Program, Wallet } from "@coral-xyz/anchor";
import { DiceGame } from "../target/types/dice_game";
import { BN } from "bn.js";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import { expect } from "chai";
import idl from "../target/idl/dice_game.json";

describe("dice-game", () => {
  let svm: ReturnType<typeof fromWorkspace>;
  let program: Program<DiceGame>;

  const house = Keypair.generate();
  const player = Keypair.generate();
  let vault: PublicKey;

  before(() => {
    svm = fromWorkspace(".");
    svm.airdrop(house.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(player.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const provider = new LiteSVMProvider(svm, new Wallet(house));
    program = new Program<DiceGame>(idl as DiceGame, provider);

    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), house.publicKey.toBuffer()],
      program.programId,
    );
  });

  it("initialize", async () => {
    await program.methods
      .initialize(new BN(2 * LAMPORTS_PER_SOL))
      .accounts({ house: house.publicKey })
      .rpc();

    const vaultAccount = svm.getAccount(vault);
    expect(vaultAccount).to.not.be.null;
    expect(vaultAccount!.lamports).to.be.greaterThanOrEqual(
      2 * LAMPORTS_PER_SOL,
    );
  });

  describe("place_bet + resolve_bet", () => {
    const seed = new BN(randomBytes(16), "le");
    const betAmount = new BN(LAMPORTS_PER_SOL / 10);
    let betPda: PublicKey;

    before(() => {
      [betPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("bet"),
          vault.toBuffer(),
          seed.toArrayLike(Buffer, "le", 16),
        ],
        program.programId,
      );
    });

    it("place_bet", async () => {
      await program.methods
        .placeBet(seed, 50, betAmount)
        .accounts({
          player: player.publicKey,
          house: house.publicKey,
        })
        .signers([player])
        .rpc();

      expect(svm.getAccount(betPda)).to.not.be.null;
    });

    it("resolve_bet", async () => {
      const betAccount = svm.getAccount(betPda);

      const sigIx = Ed25519Program.createInstructionWithPrivateKey({
        message: Buffer.from(betAccount!.data).subarray(8),
        privateKey: house.secretKey,
      });

      const sig = Buffer.from(sigIx.data.subarray(16 + 32, 16 + 32 + 64));

      await program.methods
        .resolveBet(sig)
        .accountsPartial({
          house: house.publicKey,
          player: player.publicKey,
          bet: betPda,
          instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .preInstructions([sigIx])
        .rpc();

      expect(svm.getAccount(betPda)).to.be.null;
    });
  });

  describe("place_bet + refund_bet", () => {
    const seed = new BN(randomBytes(16), "le");
    const betAmount = new BN(LAMPORTS_PER_SOL / 10);
    let betPda: PublicKey;

    before(() => {
      [betPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("bet"),
          vault.toBuffer(),
          seed.toArrayLike(Buffer, "le", 16),
        ],
        program.programId,
      );
    });

    it("place_bet", async () => {
      await program.methods
        .placeBet(seed, 50, betAmount)
        .accounts({
          player: player.publicKey,
          house: house.publicKey,
        })
        .signers([player])
        .rpc();

      expect(svm.getAccount(betPda)).to.not.be.null;
    });

    it("refund_bet", async () => {
      svm.warpToSlot(BigInt(3000));

      await program.methods
        .refundBet()
        .accountsPartial({
          player: player.publicKey,
          house: house.publicKey,
          bet: betPda,
        })
        .signers([player])
        .rpc();

      expect(svm.getAccount(betPda)).to.be.null;
    });
  });
});
