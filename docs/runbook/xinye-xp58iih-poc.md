# 芯烨 XP-58IIH 打印机 PoC 验收手册

## 1. 目的与阶段门

本手册用于在真实芯烨 XP-58IIH 网络热敏打印机上验证后续订单小票终端唯一允许使用的 capability fixture：

`apps/merchant-terminal/src/capabilities/xinye-xp58iih.verified.json`

在本手册全部必选项实测通过、fixture 测试变绿和 Android smoke 通过前：

- 不得开始可靠打印服务端或生产 Android 终端实施；
- 不得把 fake printer 的端口、编码、列宽、走纸或切刀值复制到 verified fixture；
- 不得把 App Android 资源编译成功描述为 APK、adb 或真机验证成功；
- 不得在仓库、截图、日志或 fixture 中记录门店 IP、SSID、Wi-Fi 密码、打印机序列号或签名密钥。

## 2. 前置条件

- 一台芯烨 XP-58IIH；
- 58mm 热敏纸；
- Android 测试终端与打印机位于同一可信局域网；
- 已安装并登录与项目 DCloud 版本兼容的 HBuilderX CLI；
- 本机受忽略的 Android 调试签名配置；
- Android SDK Platform Tools，`adb version` 可用；
- 只有一台目标设备出现在 `adb devices` 且状态为 `device`；
- HBuilderX pack config 使用 `platform: "android"` 与 `safemode: true`；
- 已从 `apps/merchant-terminal/dist/build/app` 包装出调试 APK；
- 环境变量 `MERCHANT_TERMINAL_SIGNING_CONFIG` 指向受忽略的 pack config；
- 环境变量 `MERCHANT_TERMINAL_DEBUG_APK` 指向期望生成并供 adb 安装的 APK。

## 3. 自检页与脱敏记录

1. 按打印机说明执行自检并打印自检页。
2. 现场核对型号确为 XP-58IIH。
3. 记录自检显示的原始 TCP 端口，但只写入最终 JSON 的 `tcpPort`，文档不抄录现场 IP。
4. `selfTestReference` 只使用脱敏引用，例如 `store-poc-2026-08-02-sheet-a`。
5. 自检页原件由门店线下保管，不提交图片。

记录：

- [ ] 型号已核对为 XP-58IIH
- [ ] 原始 TCP 端口已实测
- [ ] 自检引用已脱敏
- [ ] 未记录现场 IP、SSID、密码或序列号

## 4. 构建与安装

```bash
pnpm --filter @bake-mall/merchant-terminal test
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal lint
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
```

必须分别确认：

- [ ] `build:app-resources` 仅生成 `dist/build/app`
- [ ] `package:android` 生成真实 APK，而非把资源目录当作 APK
- [ ] 记录 APK SHA-256
- [ ] APK 包名为 `com.bakemall.merchantterminal`

## 5. 固定诊断顺序

在 Android 诊断页输入现场打印机 IP。以下步骤不得跳序：

1. `TCP_CONNECT`
2. `ASCII`
3. `CHINESE`
4. `ALIGNMENT`
5. `LONG_TEXT`
6. `FEED`
7. `CUT`（仅在明确支持且人工勾选后执行）

任一步失败即停止，不得继续切刀测试。

### 5.1 TCP

- [ ] 使用自检端口连接成功
- [ ] 错误 IP/端口能明确失败
- [ ] 连接超时符合实测值

### 5.2 编码

分别验证候选编码，不以“没有抛异常”代替纸面确认：

- [ ] GB18030 中文完整、无乱码
- [ ] GBK 中文完整、无乱码
- [ ] 最终 fixture 只写入真实通过且选定的编码

若两个编码都通过，记录选择理由；若只有一个通过，只能写入该编码。

### 5.3 列宽与对齐

从候选半角列数逐项打印，人工确认：

- [ ] ASCII 行未截断
- [ ] 中文宽度按两格计算
- [ ] `商品合计 118.00` 右对齐
- [ ] `会员优惠 -8.80` 右对齐
- [ ] `应付金额 89.20` 右对齐
- [ ] 最终 `charactersPerLine` 为真实通过值

### 5.4 长文本

- [ ] 长商品名按显示宽度换行
- [ ] 中文备注完整且没有 ESC/POS 控制字符副作用
- [ ] 配送地址完整换行
- [ ] 英文与中文混排无半字或覆盖

### 5.5 走纸

- [ ] 记录能够完整露出末行并便于撕纸的最小 `feedLines`
- [ ] 不因走纸过少遮挡末行
- [ ] 不使用明显过大的猜测值

### 5.6 切刀

默认保持：

```json
{
  "supportsCut": false,
  "cutCommandHex": null
}
```

只有同时满足以下条件才允许改为 `true`：

- [ ] 设备硬件确有切刀
- [ ] 自检或厂商资料确认命令
- [ ] 命令在真机上成功执行
- [ ] 命令未造成异常走纸、重启或乱码
- [ ] `cutCommandHex` 为完整偶数字节十六进制

未明确通过时不得尝试常见 ESC/POS 切刀命令并将其当作已验证值。

## 6. Android smoke

设置 APK 路径后运行：

```bash
MERCHANT_TERMINAL_DEBUG_APK=/absolute/path/to/debug.apk \
  pnpm --filter @bake-mall/merchant-terminal verify:android
```

验收：

- [ ] adb 安装成功
- [ ] deep link 打开诊断页
- [ ] 模拟器使用 `10.0.2.2` 连接宿主 fake printer
- [ ] fake printer 收到完整字节
- [ ] 中途断开被识别为失败
- [ ] 普通日志不输出完整打印字节或现场 secret

## 7. 写入 verified fixture

只在以上实测完成后创建 JSON，字段必须全部来自现场记录：

```json
{
  "model": "XINYE_XP_58IIH",
  "transport": "RAW_TCP",
  "tcpPort": "<实测整数>",
  "encoding": "<GB18030 或 GBK，必须实测>",
  "charactersPerLine": "<实测整数>",
  "asciiWidth": 1,
  "cjkWidth": 2,
  "feedLines": "<实测整数>",
  "supportsCut": "<实测布尔值>",
  "cutCommandHex": "<实测十六进制或 null>",
  "connectionTimeoutMs": "<实测整数>",
  "writeTimeoutMs": "<实测整数>",
  "selfTestReference": "<脱敏引用>",
  "verifiedAt": "<真实 UTC ISO 时间>",
  "verificationStatus": "PASSED"
}
```

尖括号占位符不能提交为最终 fixture。

## 8. 最终阶段门

```bash
pnpm --filter @bake-mall/merchant-terminal test:hardware
pnpm --filter @bake-mall/merchant-terminal verify:android
pnpm --filter @bake-mall/merchant-terminal test
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal lint
pnpm --filter @bake-mall/merchant-terminal build
```

最终签字项：

- [ ] verified fixture 测试通过
- [ ] Android smoke 通过
- [ ] 中文、列宽、长文本和走纸真机通过
- [ ] 切刀只在真机验证后启用
- [ ] 记录不含门店网络与设备敏感信息
- [ ] 计划 A 阶段门允许进入下一阶段
