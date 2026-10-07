-- A swap converts one asset into another inside the payer's own wallet. Its
-- ledger entries (what was spent, what was received, the network fee) are SWAP.
ALTER TYPE "WalletTxType" ADD VALUE 'SWAP';
