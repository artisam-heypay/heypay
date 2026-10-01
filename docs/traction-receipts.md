# Traction receipts (Stellar Testnet)

Every `SETTLED` payment in production, with its Stellar transaction hash, as of
the query below. This is a static export for citation in the Instawards SOW
(§2.1) — it does not update automatically. Re-run the query to refresh.

Source query, run read-only against the production database:

```sql
SELECT "reference", "stellarTxHash", "amountPhp", "netSettledPhp", "settledAt"
FROM "Payment"
WHERE status = 'SETTLED' AND "stellarTxHash" IS NOT NULL
ORDER BY "settledAt";
```

Coverage check at time of export: **17 of 17** `SETTLED` payments carry a
`stellarTxHash` — no gap between "settled" and "has an on-chain receipt."

| Reference       | Stellar Testnet tx                                                                                                                          | Requested (PHP) | Net settled (PHP) | Settled at (UTC)         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: | ------------------: | ------------------------- |
| `TXN-AYSTWR6U`   | [`2bbffe5e…04b9`](https://stellar.expert/explorer/testnet/tx/2bbffe5e64e394f53a303251af9ecbbfbc7bf7ad2b3bb65da82171a2dd8304b9)                |            500.00 |               500.00 | 2026-07-07 13:14:30.995   |
| `TXN-P6NFKVJX`   | [`6d9ce2d1…6df3d`](https://stellar.expert/explorer/testnet/tx/6d9ce2d104abbf218446fa7af312fe9c505eb6e12409d06fb4df6c0ccf26df3d)               |            200.00 |               200.00 | 2026-07-07 13:14:40.939   |
| `TXN-YJD7J5VG`   | [`538dbd0e…3844a1e`](https://stellar.expert/explorer/testnet/tx/538dbd0e54c7f4256270f15449157a39478b046226361db3f62e4c0ff3844a1e)             |            200.00 |               200.00 | 2026-07-07 13:14:50.638   |
| `TXN-SSYLLZP2`   | [`15d6cb74…2448a42`](https://stellar.expert/explorer/testnet/tx/15d6cb7418052d6a7b8d930ecf13056728eb4feb5f0d9ee5d96515e312448a42)             |            250.00 |               250.00 | 2026-07-07 13:15:40.670   |
| `TXN-4XCD4UEC`   | [`7545d0c4…b335b53`](https://stellar.expert/explorer/testnet/tx/7545d0c4870f0fde378212e168cb1bbb88af115dbcaf904dc8060fc85b335b53)             |            300.00 |               300.00 | 2026-07-07 13:39:23.611   |
| `TXN-HOARCHEL`   | [`0bc124cc…7d03f5`](https://stellar.expert/explorer/testnet/tx/0bc124cc104809a2facf9496fdf724cf4256517dd1de983354b22cb98e7d03f5)              |            234.00 |               234.00 | 2026-07-08 11:02:53.713   |
| `TXN-2LLYG35B`   | [`4cb17c35…15b0ab`](https://stellar.expert/explorer/testnet/tx/4cb17c35986b8dc89b76d891752da11bbf193261f7ce3f5cfdc1d708f715b0ab)              |            213.00 |               213.00 | 2026-07-08 11:13:59.915   |
| `TXN-2ZF4UHMH`   | [`cf17cdcc…50e4650`](https://stellar.expert/explorer/testnet/tx/cf17cdcc4bdcc024b28f399150582877af0b6dbbe7e7447469f99c850f3e4650)             |            211.00 |               211.00 | 2026-07-08 11:18:34.992   |
| `TXN-Y2WZD5QM`   | [`c5cc2aa8…f0cc01`](https://stellar.expert/explorer/testnet/tx/c5cc2aa8de5db0cdcff405851178d04155795bc9cbe04809bf178ff8f3f0cc01)              |            241.00 |               226.00 | 2026-07-08 11:51:13.978   |
| `TXN-ODVYW7CE`   | [`5e917529…d5c461`](https://stellar.expert/explorer/testnet/tx/5e917529b81c0a8043e84f16d2175498c6845bdf1ce21d3e45c1657900d5c461)              |            500.00 |               485.00 | 2026-07-08 12:06:01.780   |
| `TXN-FJCERJLO`   | [`6081f357…7275afd`](https://stellar.expert/explorer/testnet/tx/6081f357d89eb8cca6203dd33530437da591d5176c36a1a151394f3677275afd)             |            250.00 |               235.00 | 2026-07-08 12:09:09.438   |
| `TXN-6QN4PM5D`   | [`38bb5136…4b926b29`](https://stellar.expert/explorer/testnet/tx/38bb5136c3e6d94708852603a5855ee266db29413ede25234076dcbd4b926b29)            |            263.00 |               248.00 | 2026-07-10 05:20:20.759   |
| `TXN-D7JQ3ORR`   | [`1c5c52c4…8900a0f2`](https://stellar.expert/explorer/testnet/tx/1c5c52c44cd57b19a85784f3054b6d118be8fe2ceb432dac102651e08900a0f2)            |          1,000.00 |               985.00 | 2026-07-10 11:35:06.913   |
| `TXN-3ZENDPMI`   | [`00136433…dd718c3a`](https://stellar.expert/explorer/testnet/tx/001364335b304e27ba3718bd17be6a1c32c5493a6ab18f9354340dbddb718c3a)            |            192.00 |               177.00 | 2026-07-10 13:00:39.767   |
| `TXN-A3XF6IL3`   | [`0278a308…4812bdf64b7`](https://stellar.expert/explorer/testnet/tx/0278a30861debd1b00a62735fc9174b68b91cd4b2c21d49b080544812bdf64b7)         |            467.00 |               452.00 | 2026-07-13 05:58:24.841   |
| `TXN-TCKD3MB5`   | [`2ccccbc8…f86f882c7`](https://stellar.expert/explorer/testnet/tx/2ccccbc8b2f56990f623ebdbac642a5718de14245810fda39f017cef86f882c7)           |            350.00 |               335.00 | 2026-07-15 08:35:05.348   |
| `TXN-Q5IEJAHP`   | [`d40af4e1…e13d847a`](https://stellar.expert/explorer/testnet/tx/d40af4e1da9d2f351b486ecd7928c2d39e8da0bbb0a54c78176ee151e13d847a)             |            320.00 |               305.00 | 2026-07-15 09:13:11.088   |
| **Total (17)**   |                                                                                                                                                  |      **5,691.00** |         **5,556.00** |                            |

The gap between requested and net-settled PHP on some rows is PDAX trading/cash-out
fees (`pdaxFeePhp`), deducted before payout — not a discrepancy or a failed leg.
