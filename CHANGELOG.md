# Changelog

## [1.3.0](https://github.com/PhyberApex/hibiki/compare/v1.2.0...v1.3.0) (2026-10-07)


### Features

* **audio:** add JS/WASM backend decoder module and ADR-0003 ([#440](https://github.com/PhyberApex/hibiki/issues/440)) ([89f33e2](https://github.com/PhyberApex/hibiki/commit/89f33e286896d11c7beb859bd096518a0cc06da6))
* **audio:** auto-recover or tear down voice connections on Discord disconnect ([#427](https://github.com/PhyberApex/hibiki/issues/427)) ([c9f2e11](https://github.com/PhyberApex/hibiki/commit/c9f2e11d7d12ed5908e099d863e95fb6ba4c8d77)), closes [#411](https://github.com/PhyberApex/hibiki/issues/411)
* **audio:** support overlapping music streams per guild ([#436](https://github.com/PhyberApex/hibiki/issues/436)) ([97aa9e4](https://github.com/PhyberApex/hibiki/commit/97aa9e425d547f4425c6145d23d47f5a80d78b6e)), closes [#432](https://github.com/PhyberApex/hibiki/issues/432)
* **config:** add persisted Scene fade length setting ([#435](https://github.com/PhyberApex/hibiki/issues/435)) ([7134433](https://github.com/PhyberApex/hibiki/commit/7134433b38abe4c62fb106892aea97ab794a2136))
* **config:** encrypt Discord token and Claude Vision key at rest ([#428](https://github.com/PhyberApex/hibiki/issues/428)) ([11cfbe6](https://github.com/PhyberApex/hibiki/commit/11cfbe628cc06d55f496f858aa8295b760aac2a1))
* **player:** persist master volume, remove dead volume API ([#453](https://github.com/PhyberApex/hibiki/issues/453)) ([9d479ff](https://github.com/PhyberApex/hibiki/commit/9d479ff127f2f91c53a4445537bf4a19ae870e4d))
* **player:** play Scene Ambience through the backend decoder ([#451](https://github.com/PhyberApex/hibiki/issues/451)) ([185e2ed](https://github.com/PhyberApex/hibiki/commit/185e2edce24cfc85c96cca25e6a42340804534ed)), closes [#417](https://github.com/PhyberApex/hibiki/issues/417)
* **player:** play Scene Effects through the backend decoder ([#452](https://github.com/PhyberApex/hibiki/issues/452)) ([7509a6c](https://github.com/PhyberApex/hibiki/commit/7509a6cf5b4f4dd5abc4ca22b3b22b6ff717a5b6))
* **player:** play Scene Music through the backend decoder ([#450](https://github.com/PhyberApex/hibiki/issues/450)) ([b89bf07](https://github.com/PhyberApex/hibiki/commit/b89bf07bc6eebaca8512126d9b8c6dbacf800d03))
* **scenes:** allow overlapping Effect playback ([#424](https://github.com/PhyberApex/hibiki/issues/424)) ([b4cb656](https://github.com/PhyberApex/hibiki/commit/b4cb656900c3d3c94762f764e64077173db4efae))
* **scenes:** crossfade on Scene switch instead of cutting to silence ([#439](https://github.com/PhyberApex/hibiki/issues/439)) ([8416bb2](https://github.com/PhyberApex/hibiki/commit/8416bb2c5b53c7a4c102ece692bc8d9f1b5032ef))
* **scenes:** track the playing Scene separately from the open Scene ([#434](https://github.com/PhyberApex/hibiki/issues/434)) ([700e4b5](https://github.com/PhyberApex/hibiki/commit/700e4b529956d70b5699556c00d12cea59062697))
* **storage:** make JSON stores crash-safe with atomic writes and backups ([#421](https://github.com/PhyberApex/hibiki/issues/421)) ([902ee22](https://github.com/PhyberApex/hibiki/commit/902ee22c67d33a9b057bf58921902b71d825d53b))
* **ui:** collapse main window to a compact session layout below 900px ([#429](https://github.com/PhyberApex/hibiki/issues/429)) ([48aad58](https://github.com/PhyberApex/hibiki/commit/48aad583a11a6dfcb5924e53da543cafaf5bfc32)), closes [#413](https://github.com/PhyberApex/hibiki/issues/413)
* **ui:** rhythmic status pulses with accessibility toggles ([#336](https://github.com/PhyberApex/hibiki/issues/336)) ([dfea553](https://github.com/PhyberApex/hibiki/commit/dfea553a4254d2439f49cc89ca8f0f1f80b843d7))
* **vision:** add OpenAI-compatible Vision Provider alongside Claude ([#426](https://github.com/PhyberApex/hibiki/issues/426)) ([e441944](https://github.com/PhyberApex/hibiki/commit/e441944b125b9f0411719e7d5c3f216a322b565a)), closes [#335](https://github.com/PhyberApex/hibiki/issues/335)
* **vision:** Vision to Vibe — match tagged sounds to an image's mood ([#337](https://github.com/PhyberApex/hibiki/issues/337)) ([c615614](https://github.com/PhyberApex/hibiki/commit/c615614818d65d9559f7a29b9c1742d3b9328c41))


### Bug Fixes

* **build:** unbreak packaging on Electron 44 ([#403](https://github.com/PhyberApex/hibiki/issues/403)) ([c3b1b92](https://github.com/PhyberApex/hibiki/commit/c3b1b92dff5b94ad035ea6fe0e0257e7a06891f0))
* **deps:** update dependency @anthropic-ai/sdk to ^0.118.0 ([#344](https://github.com/PhyberApex/hibiki/issues/344)) ([dd8cb37](https://github.com/PhyberApex/hibiki/commit/dd8cb3704c0b9b04c23ee5cb8a0e8c919eb52b0f))
* **deps:** update dependency @anthropic-ai/sdk to ^0.120.0 ([#345](https://github.com/PhyberApex/hibiki/issues/345)) ([9947938](https://github.com/PhyberApex/hibiki/commit/994793852968b0889fccd7cd5ac95a93dd20f9bc))
* **deps:** update dependency @anthropic-ai/sdk to ^0.122.0 ([#353](https://github.com/PhyberApex/hibiki/issues/353)) ([f6c36e6](https://github.com/PhyberApex/hibiki/commit/f6c36e6919f115f1dba3aca327adb4e0436d5bde))
* **deps:** update dependency @anthropic-ai/sdk to ^0.123.0 ([#362](https://github.com/PhyberApex/hibiki/issues/362)) ([eb9b0da](https://github.com/PhyberApex/hibiki/commit/eb9b0da1383109cef64841cfcad7b653c7a2f42b))
* **deps:** update dependency @anthropic-ai/sdk to ^0.124.0 ([#373](https://github.com/PhyberApex/hibiki/issues/373)) ([b9733e3](https://github.com/PhyberApex/hibiki/commit/b9733e36c75a336cc188d4168df0ae9031cf0851))
* **deps:** update dependency @anthropic-ai/sdk to ^0.125.0 ([#380](https://github.com/PhyberApex/hibiki/issues/380)) ([2f723d1](https://github.com/PhyberApex/hibiki/commit/2f723d1290fa4d16e5448db901a31b48a9b3bf18))
* **deps:** update dependency @anthropic-ai/sdk to ^0.126.0 ([#388](https://github.com/PhyberApex/hibiki/issues/388)) ([b2a3bed](https://github.com/PhyberApex/hibiki/commit/b2a3bed7da21ca91b370781fb75d65cd7f52c3a6))
* **deps:** update dependency @anthropic-ai/sdk to ^0.128.0 ([#395](https://github.com/PhyberApex/hibiki/issues/395)) ([aa83382](https://github.com/PhyberApex/hibiki/commit/aa833820000cc53c545b42607bffbe38d7130667))
* **deps:** update dependency @anthropic-ai/sdk to ^0.129.0 ([#423](https://github.com/PhyberApex/hibiki/issues/423)) ([2fd9b98](https://github.com/PhyberApex/hibiki/commit/2fd9b98d79f33085b51fac42ea6146af383152b9))
* **deps:** update dependency @anthropic-ai/sdk to ^0.131.0 ([#444](https://github.com/PhyberApex/hibiki/issues/444)) ([272cabc](https://github.com/PhyberApex/hibiki/commit/272cabc48cb9ab89a4914a10c5c2e8b8563c6d02))
* **deps:** update dependency adm-zip to ^0.6.0 ([#286](https://github.com/PhyberApex/hibiki/issues/286)) ([b5f6d9e](https://github.com/PhyberApex/hibiki/commit/b5f6d9e26b4f3b798877a9cd05272b7fe7bb3bdf))
* **deps:** update dependency dotenv to v18 ([#397](https://github.com/PhyberApex/hibiki/issues/397)) ([6e60e46](https://github.com/PhyberApex/hibiki/commit/6e60e46e7347243ff049020a52d8abb8ef861bc8))
* **deps:** update dependency pinia to v4 ([#290](https://github.com/PhyberApex/hibiki/issues/290)) ([078643c](https://github.com/PhyberApex/hibiki/commit/078643c3234e0bdfe47d628221379211b76434bd))
* **player:** graceful shutdown teardown, drop native @discordjs/opus ([#457](https://github.com/PhyberApex/hibiki/issues/457)) ([035baa8](https://github.com/PhyberApex/hibiki/commit/035baa81d38db72a34fa7c784b78bcd7df387992))
* **pnpm:** fix broken CI build by moving pnpm settings to pnpm-workspace.yaml ([#310](https://github.com/PhyberApex/hibiki/issues/310)) ([647921d](https://github.com/PhyberApex/hibiki/commit/647921da227accc5df75f6550e580da41445a100))
* **pnpm:** override @electron/node-gyp to unblock Renovate lockfile updates ([#321](https://github.com/PhyberApex/hibiki/issues/321)) ([36d28ea](https://github.com/PhyberApex/hibiki/commit/36d28ea90ceb2290b5abf69d902b03d7ba5dcc9f))

## [1.2.0](https://github.com/PhyberApex/hibiki/compare/v1.1.0...v1.2.0) (2026-03-19)


### Features

* Plugin system ([#103](https://github.com/PhyberApex/hibiki/issues/103)) ([80e72cb](https://github.com/PhyberApex/hibiki/commit/80e72cb52691e9e9dbcfa02ffbe47c0dff300ef7)), closes [#102](https://github.com/PhyberApex/hibiki/issues/102)
* Plugin system revamped ([#105](https://github.com/PhyberApex/hibiki/issues/105)) ([44f9e99](https://github.com/PhyberApex/hibiki/commit/44f9e999935f214188b12ec0c24dd30c25c99d65))
* UX improvements for plugin system ([#108](https://github.com/PhyberApex/hibiki/issues/108)) ([26e7161](https://github.com/PhyberApex/hibiki/commit/26e716165570b49c21f2b27e6eb585d292533b53))


### Bug Fixes

* Build of index ([#106](https://github.com/PhyberApex/hibiki/issues/106)) ([c289852](https://github.com/PhyberApex/hibiki/commit/c289852f5822a67b5da0453e1af5210c1ee47c57))
* UI improvements ([#109](https://github.com/PhyberApex/hibiki/issues/109)) ([0378ecb](https://github.com/PhyberApex/hibiki/commit/0378ecb09e73d75d71ad70066aacaca8fef47244))
* Update cozy-tavern.json ([#107](https://github.com/PhyberApex/hibiki/issues/107)) ([fea40dd](https://github.com/PhyberApex/hibiki/commit/fea40ddb6de1adedb9aa47f587ed965770b5803b))

## [1.1.0](https://github.com/PhyberApex/hibiki/compare/v1.0.0...v1.1.0) (2026-03-15)


### Features

* Remove splash screen on the start of the app ([#81](https://github.com/PhyberApex/hibiki/issues/81)) ([1619fc1](https://github.com/PhyberApex/hibiki/commit/1619fc11f6286cd41ec954553c10f589f5954b1b))
* UI rework ([#94](https://github.com/PhyberApex/hibiki/issues/94)) ([14ada77](https://github.com/PhyberApex/hibiki/commit/14ada77d530b12065f888c327587fa5d652b5799))
* Update electron to 39 ([#80](https://github.com/PhyberApex/hibiki/issues/80)) ([8c22680](https://github.com/PhyberApex/hibiki/commit/8c22680e63c314a19a4068fb9689813c2c5bc889))
* Update electron to 41 and node to 24 ([#84](https://github.com/PhyberApex/hibiki/issues/84)) ([b425f56](https://github.com/PhyberApex/hibiki/commit/b425f56d8221020c8c8f7218fe3c336247c3cbd2))


### Bug Fixes

* Audio not working in streaming ([#78](https://github.com/PhyberApex/hibiki/issues/78)) ([e936043](https://github.com/PhyberApex/hibiki/commit/e9360433929540da0d5dc9a99cdc604c2adb6566))
* **deps:** update dependency dotenv to v17 ([#77](https://github.com/PhyberApex/hibiki/issues/77)) ([6abcfae](https://github.com/PhyberApex/hibiki/commit/6abcfae3cab2ccf71fa5121934a06b621dbbf954))

## [1.0.0](https://github.com/PhyberApex/hibiki/compare/v0.4.0...v1.0.0) (2026-03-10)


### ⚠ BREAKING CHANGES

* Complete overhaul!

### Features

* Add slash-commands ([#44](https://github.com/PhyberApex/hibiki/issues/44)) ([ba7ef6b](https://github.com/PhyberApex/hibiki/commit/ba7ef6b9440384570429f0b102f89aae434eda6b))
* Better media management ([#55](https://github.com/PhyberApex/hibiki/issues/55)) ([f5690fa](https://github.com/PhyberApex/hibiki/commit/f5690fa63f140c70fea768f76b366b3de343ced3)), closes [#51](https://github.com/PhyberApex/hibiki/issues/51)
* **bot:** If bot crashes we now are able to joing again and retain state ([#18](https://github.com/PhyberApex/hibiki/issues/18)) ([ed98368](https://github.com/PhyberApex/hibiki/commit/ed983682d2662a8ba76fe7341e9f8b134ff9da35))
* Initial commit ([8abcbca](https://github.com/PhyberApex/hibiki/commit/8abcbca6572705c077062290b3f26bc624d222bc))
* Switch to electron version ([3d550ec](https://github.com/PhyberApex/hibiki/commit/3d550eceb4781aef672b772f421b3d03e594942a))
* **volume:** Added possibility to control volume ([#6](https://github.com/PhyberApex/hibiki/issues/6)) ([6433bf4](https://github.com/PhyberApex/hibiki/commit/6433bf4b4e608fba40ff6e7bc722b91051f3b718))
* **web:** Reworked UI for playback ([19b9a06](https://github.com/PhyberApex/hibiki/commit/19b9a06a1eddfcf80f9ea16f256c70b84849c9c7))
* **web:** Reworked UI for playback ([#29](https://github.com/PhyberApex/hibiki/issues/29)) ([19b9a06](https://github.com/PhyberApex/hibiki/commit/19b9a06a1eddfcf80f9ea16f256c70b84849c9c7))


### Bug Fixes

* **deps:** Reverted discord voice update ([#14](https://github.com/PhyberApex/hibiki/issues/14)) ([309902b](https://github.com/PhyberApex/hibiki/commit/309902b7b068d1b7d96aef30c8cf7ee2991c94ea))
* **deps:** update dependency @discordjs/voice to ^0.19.0 ([#11](https://github.com/PhyberApex/hibiki/issues/11)) ([693e78c](https://github.com/PhyberApex/hibiki/commit/693e78cb294b2bad6f32542a1a40a07262b0b44f))
* **deps:** update dependency @discordjs/voice to ^0.19.0 with adding davey for it to work ([#17](https://github.com/PhyberApex/hibiki/issues/17)) ([78dc850](https://github.com/PhyberApex/hibiki/commit/78dc850ed265fae370e0605b49cdc17a1d390efa))
* **deps:** update dependency discord-api-types to ^0.38.0 ([#16](https://github.com/PhyberApex/hibiki/issues/16)) ([60db843](https://github.com/PhyberApex/hibiki/commit/60db8431cdc14a39bd48c74427fa6fb882bd2c07))
* **deps:** update dependency multer to v2 ([#25](https://github.com/PhyberApex/hibiki/issues/25)) ([589c799](https://github.com/PhyberApex/hibiki/commit/589c799e3e76e0f216415f2cc5bdf5d4b9ba2939))
* **deps:** update dependency uuid to v13 ([#26](https://github.com/PhyberApex/hibiki/issues/26)) ([1704a38](https://github.com/PhyberApex/hibiki/commit/1704a38046577a9243186e04502bf6e9c08040b0))
* **text:** Fixed the !menu / !panel not working ([#7](https://github.com/PhyberApex/hibiki/issues/7)) ([bc8e421](https://github.com/PhyberApex/hibiki/commit/bc8e42191d96b1dbeff1d5e06a2b341461439ab9))

## [0.4.0](https://github.com/PhyberApex/hibiki/compare/hibiki-v0.3.0...hibiki-v0.4.0) (2026-02-21)


### Features

* Add slash-commands ([#44](https://github.com/PhyberApex/hibiki/issues/44)) ([ba7ef6b](https://github.com/PhyberApex/hibiki/commit/ba7ef6b9440384570429f0b102f89aae434eda6b))

## [0.3.0](https://github.com/PhyberApex/hibiki/compare/hibiki-v0.2.0...hibiki-v0.3.0) (2026-02-16)


### Features

* **web:** Reworked UI for playback ([19b9a06](https://github.com/PhyberApex/hibiki/commit/19b9a06a1eddfcf80f9ea16f256c70b84849c9c7))
* **web:** Reworked UI for playback ([#29](https://github.com/PhyberApex/hibiki/issues/29)) ([19b9a06](https://github.com/PhyberApex/hibiki/commit/19b9a06a1eddfcf80f9ea16f256c70b84849c9c7))


### Bug Fixes

* **deps:** update dependency multer to v2 ([#25](https://github.com/PhyberApex/hibiki/issues/25)) ([589c799](https://github.com/PhyberApex/hibiki/commit/589c799e3e76e0f216415f2cc5bdf5d4b9ba2939))
* **deps:** update dependency uuid to v13 ([#26](https://github.com/PhyberApex/hibiki/issues/26)) ([1704a38](https://github.com/PhyberApex/hibiki/commit/1704a38046577a9243186e04502bf6e9c08040b0))

## [0.2.0](https://github.com/PhyberApex/hibiki/compare/hibiki-v0.1.1...hibiki-v0.2.0) (2026-02-15)


### Features

* **bot:** If bot crashes we now are able to joing again and retain state ([#18](https://github.com/PhyberApex/hibiki/issues/18)) ([ed98368](https://github.com/PhyberApex/hibiki/commit/ed983682d2662a8ba76fe7341e9f8b134ff9da35))


### Bug Fixes

* **deps:** Reverted discord voice update ([#14](https://github.com/PhyberApex/hibiki/issues/14)) ([309902b](https://github.com/PhyberApex/hibiki/commit/309902b7b068d1b7d96aef30c8cf7ee2991c94ea))
* **deps:** update dependency @discordjs/voice to ^0.19.0 ([#11](https://github.com/PhyberApex/hibiki/issues/11)) ([693e78c](https://github.com/PhyberApex/hibiki/commit/693e78cb294b2bad6f32542a1a40a07262b0b44f))
* **deps:** update dependency @discordjs/voice to ^0.19.0 with adding davey for it to work ([#17](https://github.com/PhyberApex/hibiki/issues/17)) ([78dc850](https://github.com/PhyberApex/hibiki/commit/78dc850ed265fae370e0605b49cdc17a1d390efa))
* **deps:** update dependency discord-api-types to ^0.38.0 ([#16](https://github.com/PhyberApex/hibiki/issues/16)) ([60db843](https://github.com/PhyberApex/hibiki/commit/60db8431cdc14a39bd48c74427fa6fb882bd2c07))

## [0.1.1](https://github.com/PhyberApex/hibiki/compare/hibiki-v0.1.0...hibiki-v0.1.1) (2026-02-15)


### Bug Fixes

* **text:** Fixed the !menu / !panel not working ([#7](https://github.com/PhyberApex/hibiki/issues/7)) ([bc8e421](https://github.com/PhyberApex/hibiki/commit/bc8e42191d96b1dbeff1d5e06a2b341461439ab9))

## [0.1.0](https://github.com/PhyberApex/hibiki/compare/hibiki-v0.0.1...hibiki-v0.1.0) (2026-02-15)


### Features

* Initial commit ([8abcbca](https://github.com/PhyberApex/hibiki/commit/8abcbca6572705c077062290b3f26bc624d222bc))
* **volume:** Added possibility to control volume ([#6](https://github.com/PhyberApex/hibiki/issues/6)) ([6433bf4](https://github.com/PhyberApex/hibiki/commit/6433bf4b4e608fba40ff6e7bc722b91051f3b718))
