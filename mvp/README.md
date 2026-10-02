# mvp/ —— MVP 版本的归档位

这里**不跑代码**，也不放正在开发的源码。活代码在 `demo/`，一切以仓库当前状态为准。

## 里面有什么

| 目录 | 是什么 |
|---|---|
| `ai-weekly/` | **装好的应用本体**（装的是最新打出来的那一版），点开就能用；不是源码，也不进版本库 |
| `README.md` | 就是这份说明 |

以前这里还放着两份源码快照（`mvp-v0.5/`、`mvp-v0.8/`），已经删掉了 —— 内容一个字都不会丢：
它们本来就是从 tag 里导出来的，需要时用同一条命令（见下）再导一次就行；文件本身也还在
提交历史里（是 `9b7f7c8` 那次提交加进来的，`git show 9b7f7c8:mvp/mvp-v0.8/demo/package.json` 还看得到）。

## 回看旧版本：用 tag，不要用文件夹

```powershell
git tag --list 'mvp*'                  # 有哪些：mvp-v0.5 / mvp-v0.6 / mvp-v0.8 / mvp-v0.8.1 / mvp-v0.9
git log --oneline --decorate           # 哪个提交是哪个 tag

git show mvp-v0.8:demo/package.json    # 只看一个文件，不用切
git diff mvp-v0.8 mvp-v0.8.1 --stat    # 两版之间差了什么、改了多少

git checkout mvp-v0.8                  # 整棵树切到那一版（看完切回来：git checkout main）
```

`mvp-v0.6` 到 `mvp-v0.8` 之间的 0.7 那批改动当时漏了 tag，只能在提交历史里看。

**为什么不留快照文件夹**：一份快照和它对应的 tag 内容完全一样，却多占一份工作区，
翻目录时还要在两份几乎相同的源码里挑，更容易让人误以为这里才是源码。tag 能 checkout、
能 diff、能回滚，也不额外占空间 —— 有 git 就没必要再抄一份。

代价得说清楚：**tag 在 `.git` 里，而 `.git` 和这个工作区在同一块盘上，仓库也没有远端。**
也就是说整个项目现在只有这一份拷贝。要真正的备份，得把仓库推到远端，或者导出一次
`git bundle` 放到别的盘去。

## 万一还要再导一次源码快照

两个坑（都踩过，写下来省下一次）：

```powershell
# ⚠️ 必须显式列出顶层路径，不能直接 git archive <tag>：
#    mvp/ 自己进了版本库，整棵树导出会把 mvp/ 一起塞进去，于是变成
#    mvp/mvp-v0.9/mvp/mvp-v0.5/ 这种套娃。
# ⚠️ 中文文件名必须走 zip；tar 在 Windows 上会把 docs/ 里的中文名解坏（实测踩过）。
git archive --format=zip -o "$env:TEMP\snap.zip" mvp-v0.9 AGENTS.md .gitignore demo docs
Expand-Archive -Path "$env:TEMP\snap.zip" -DestinationPath "$env:TEMP\mvp-v0.9" -Force
```

导到仓库外面去就行（比如别的盘）。要是导回 `mvp/`，还得在 `.gitignore` 里单独放行
（`!mvp/mvp-v0.9/`），再占一份版本库空间 —— 没必要。

## 归档下一份：打个 tag 就够了

```powershell
git tag -a mvp-v0.9 -m "0.9：一句话说清这一版做了什么"
```

tag 是权威版本：能 checkout、能 diff、能回滚。**不再往本目录导源码快照。**

## 打包产物不在这里

`npm run dist` 出来的安装包在 `demo\release\`（`ai-weekly-<版本>-setup.exe`，约 107 MB），
免安装版在 `demo\release\win-unpacked\`。那些都是构建产物，永远不进版本库。

`ai-weekly/` 是**装出来的那一份**：用上面那个安装包装到本目录，方便手上不跑构建时直接点开。
它同样不进版本库（`mvp/*` 默认整块忽略就是为这个）—— 里面是几百 MB 的 Electron 运行时。

升级它：跑一次新的安装包，安装路径仍旧选 `mvp\ai-weekly`，NSIS 会就地覆盖成新版本。
**配置与周归档都不在这个目录里**，它们在 `%APPDATA%\ai-weekly\`（`config.json` /
`weeks.json`），升级不会碰它们。0.9.0 起不再有 `session.json` —— 采访流那套整条链路撤掉了，
旧的那份留在原处、不再读写（也不用删，它不会再变大）。
