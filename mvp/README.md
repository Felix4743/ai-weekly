# mvp/ —— MVP 版本的归档位

这里**不跑代码**，也不放正在开发的源码。活代码在 `demo/`，一切以仓库当前状态为准。

## 里面有什么

| 目录 | 是什么 | 对应 tag |
|---|---|---|
| `mvp-v0.5/` | M0–M4 全部完成（文档 v0.5）时的源码快照 | `mvp-v0.5` |
| `mvp-v0.8/` | M0–M7 全部完成（文档 v0.8）时的源码快照 | `mvp-v0.8` |
| `ai-weekly/` | **装好的应用本体**（装的是最新打出来的那一版，和上面的快照不一定同版），点开就能用；不是源码，也不进版本库 | — |

快照是用 `git archive` 从 tag 导出的**纯源码**：`mvp-v0.5` 是 75 个文件 / 0.5 MB，
`mvp-v0.8` 是 91 个文件 / 0.67 MB，都不含 `node_modules`、不含 `dist/`、不含任何 exe ——
每个文件都逐个比对过 blob 哈希与 tag 一致，一个不差。

**只给里程碑版本导快照。** 中间的版本只打 tag、不导文件夹 —— 否则这里会堆十几份几乎
一模一样的源码，翻起来比 tag 还麻烦。要看中间版本：`git checkout mvp-v0.8.1`。
（`mvp-v0.6` 到 `mvp-v0.8` 之间的 0.7 那批改动当时漏了 tag，只能在提交历史里看。）

## 为什么既有 tag 又有这个文件夹

- **tag 才是权威版本**：`git checkout mvp-v0.8` 能拿到完整历史、能 diff、能回滚，且不额外占空间。
- **这个文件夹是给人翻的**：手上没 git、或者不想 checkout 的时候，点开就能看见当时长什么样。

两者内容一致，所以：

> **不要在这里改代码。** 它是一份冻结的存档 —— 改了不生效，也不会有人知道。
> 要改就改 `demo/`，改完按需要打新的 tag。

## 怎么归档下一份

```powershell
# 1) 给当前状态打 tag（权威版本）
git tag -a mvp-v0.9 -F 一段说明.txt

# 2) 导出源码快照到本目录
#    ⚠️ 必须显式列出要哪些顶层路径，不能直接 git archive <tag>：
#       mvp/ 自己已经进了版本库，整棵树导出会把 mvp/mvp-v0.5/ 一起塞进新快照里，
#       于是出现 mvp/mvp-v0.9/mvp/mvp-v0.5/ 这种套娃。
#    ⚠️ 中文文件名必须走 zip；tar 在 Windows 上会把 docs/ 里的中文名解坏（实测踩过）。
git archive --format=zip -o "$env:TEMP\snap.zip" mvp-v0.9 AGENTS.md .gitignore demo docs
Expand-Archive -Path "$env:TEMP\snap.zip" -DestinationPath mvp\mvp-v0.9 -Force

# 3) 让新目录进版本库：根 .gitignore 里 mvp/* 默认整块忽略，要单独放行
#    !mvp/mvp-v0.9/
```

## 打包产物不在这里

`npm run dist` 出来的安装包在 `demo\release\`（`ai-weekly-<版本>-setup.exe`，约 107 MB），
免安装版在 `demo\release\win-unpacked\`。那些都是构建产物，永远不进版本库。

`ai-weekly/` 是**装出来的那一份**：用上面那个安装包装到本目录，方便手上不跑构建时直接点开。
它同样不进版本库（`mvp/*` 默认整块忽略就是为这个）—— 里面是几百 MB 的 Electron 运行时。

升级它：跑一次新的安装包，安装路径仍旧选 `mvp\ai-weekly`，NSIS 会就地覆盖成新版本。
**配置、会话与周归档都不在这个目录里**，它们在 `%APPDATA%\ai-weekly\`（`config.json` /
`session.json` / `weeks.json`），升级不会碰它们。
