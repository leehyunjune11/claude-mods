# claude-mods

Claude Code mod 모음입니다. 폴더 하나가 mod 하나입니다.

| mod | 설명 |
|---|---|
| [idle-rpg](idle-rpg) | 프롬프트 위 띠에서 디버거 기사가 버그 몬스터를 사냥하는 방치형 RPG. `/rpg` |
| [office](office) | 할 일 진행률 게이지와 에이전트 오피스 패널 |
| [session-meter](session-meter) | 세션·오늘·이번 주·이번 달 요금, 컨텍스트, 캐시, 사용 한도 계기판. `/meter`, `/taxi` |
| [quest-board](quest-board) | 할 일을 RPG 퀘스트로 보여 주는 픽셀아트 전투 화면. [yudility/claude-rpg-quest-mod](https://github.com/yudility/claude-rpg-quest-mod)를 git subtree로 포함 (MIT) |

## 설치

쓰고 싶은 mod 폴더를 `~/.claude/mods/` 아래에 두고, `~/.claude/settings.json`의 `env.CLAUDE_CODE_PLUGIN_DIRS`에 `:`로 이어 추가합니다.

## quest-board 원본 업데이트 받기

```sh
git subtree pull --prefix=quest-board https://github.com/yudility/claude-rpg-quest-mod.git main
```
