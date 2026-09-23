# mvp/ —— MVP 版本的归档位

这里**不跑代码**，也不放正在开发的源码。活代码在 `demo/`，一切以仓库当前状态为准。

## 里面有什么

| 目录 | 是什么 | 对应 tag |
|---|---|---|
| `mvp-v0.5/` | M0–M4 全部完成（文档 v0.5）时的源码快照 | `mvp-v0.5` |

快照是用 `git archive` 从 tag 导出的**纯源码**：75 个文件、约 0.5 MB，
不含 `node_modules`、不含 `dist/`、不含任何 exe —— 逐文件与 tag 比对过，一个不差。

## 为什么既有 tag 又有这个文件夹

- **tag 才是权威版本**：`git checkout mvp-v0.5` 能拿到完整历史、能 diff、能回滚，且不额外占空间。
- **这个文件夹是给人翻的**：手上没 git、或者不想 checkout 的时候，点开就能看见当时长什么样。

两者内容一致，所以：

> **不要在这里改代码。** 它是一份冻结的存档 —— 改了不生效，也不会有人知道。
> 要改就改 `demo/`，改完按需要打新的 tag。

## 怎么归档下一份

```powershell
# 1) 给当前状态打 tag（权威版本）
git tag -a mvp-v0.6 -m "M5：轮数扩容 + 自由聊 + 专属采访者"

# 2) 导出源码快照到本目录
#    中文文件名必须走 zip；tar 在 Windows 上会把 docs/ 里的中文名解坏（实测踩过）
git archive --format=zip -o "$env:TEMP\snap.zip" mvp-v0.6
Expand-Archive -Path "$env:TEMP\snap.zip" -DestinationPath mvp\mvp-v0.6 -Force

# 3) 让新目录进版本库：根 .gitignore 里 mvp/* 默认整块忽略，要单独放行
#    !mvp/mvp-v0.6/
```

## 打包产物不在这里

`npm run dist` 出来的安装包在 `demo\release\`（`ai-weekly-*-setup.exe`，约 107 MB），
免安装版在 `demo\release\win-unpacked\`。那些都是构建产物，永远不进版本库。

`mvp/*` 默认整块忽略，就是为了防止有人把装好的应用（几百 MB 的 Electron）
误提交进来 —— 这个目录里以前确实放过一份，已经清掉了。
