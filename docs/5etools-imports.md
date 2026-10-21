# 5etools imports

Use the **5e.tools base URL** field to select the source installation. For a local server, enter `http://localhost:5050/`; a pasted `index.html` URL is also accepted. The installation must contain both the site data and its image collection. Tableforge's host downloads the source files, so `localhost` refers to the computer running Tableforge, even when the DM is using another device.

## Supported workflows

- **Create from 5e.tools campaign** creates a campaign from the selected book's maps. All DM and player versions are selected initially; exclude any you do not want before importing.
- **Import from 5e.tools → Campaign book** adds the chosen maps to an existing campaign. **Single map** searches map titles and campaign names and adds one board.
- **Token library → Find Monsters → 5e.tools** searches the bestiary and saves a token with CR, AC, HP, size, type, darkvision and source. Copied monsters inherit these quick stats, including supported template changes. Artwork is downloaded into the campaign before the token is marked saved. Entries without token artwork can still be saved.
- **Assets** accepts downloaded source images through the normal upload control. Supported image formats are PNG, JPEG and WebP. Audio/video uploads retain the existing MP3, WAV, MP4, WebM and MOV support.

Imported map and token artwork uses local campaign asset paths and travels with campaign ZIP exports. Adding maps to an existing campaign preserves its published player board. Creating a new campaign opens it in the same way as normal campaign creation.

Campaign imports contain map boards, not adventure text, encounters or automatically placed monsters. The bestiary imports quick stats, not complete stat blocks. Search results show up to 30 entries; narrow the search when needed.

5etools map regions are clickable adventure areas, not measured walls. They remain in each board's `fiveETools` metadata. **Use map area outlines as estimated walls** is optional and off by default. Review estimates before using lighting; doors and lights cannot be inferred from those regions. Grid dimensions are estimates, especially when source grids use hexagons, offsets or unusual scales. Original grid metadata is retained for reference.

## Retry feedback

Each operation shows its attempt number and local time. A retry replaces the previous feedback with an in-progress state, then a new result. Server failures also carry a unique request ID and, for source failures, the requested URL. Changing the source or search text clears old results and invalidates earlier requests so late responses cannot overwrite the new attempt.

Map batches save only after every selected image downloads successfully. A failure or cancellation before the commit removes staged files and leaves existing boards intact; failed creation leaves no empty campaign. If the connection disappears while the host confirms the final commit, check the campaign before retrying, as the import may already be saved. Asset uploads report how many individual files succeeded before a failure.

| Code | Meaning and next step |
| --- | --- |
| `INVALID_URL` | Enter a complete HTTP(S) site URL without embedded login credentials. |
| `HOST_UNREACHABLE` | The browser cannot reach Tableforge. Start/reconnect to its host. |
| `SOURCE_UNREACHABLE` | Tableforge cannot connect to the source. Check the URL and start the local 5etools server. |
| `SOURCE_TIMEOUT` | A source download exceeded the time limit. Check the source and retry. |
| `SOURCE_HTTP_404` | A data or image file is missing. Check the base URL and install/update the relevant source files. |
| `SOURCE_HTTP_401` / `SOURCE_HTTP_403` | The source refused access. Use an accessible installation or mirror. |
| `SOURCE_HTTP_429` | The source is limiting requests. Wait before retrying. |
| `SOURCE_INVALID_JSON` / `INVALID_MAP_CATALOG` / `INVALID_BESTIARY_INDEX` / `INVALID_BESTIARY_DATA` | The source returned invalid or unexpected data, sometimes a login/error page. Check the site root and update its data. |
| `SOURCE_NOT_IMAGE` | The response is not a supported PNG, JPEG or WebP image. Check the requested image URL. |
| `SOURCE_TOO_LARGE` | A remote file exceeded 50 MB. Choose a smaller asset. |
| `MONSTER_COPY_*` / `MONSTER_TEMPLATE_*` | A required parent/template is missing, circular, or uses a stat change Tableforge cannot interpret. Update the source or use another entry; unsupported changes are not silently guessed. |
| `CAMPAIGN_NAME_EXISTS` | Choose another campaign name or import into the existing campaign. |
| `TOKEN_ALREADY_SAVED` | Use the existing entry under Saved Tokens. |
| `ASSET_UNSUPPORTED_FORMAT` | Upload one of the formats listed in the asset picker. |
| `IMPORT_INTERRUPTED` | The host did not confirm completion. Inspect the campaign before retrying. |

Custom sources never silently switch to a public catalog. Only the default `https://5e.tools/` source can fall back to its public data mirror, and feedback explicitly discloses that fallback. Artwork still comes from the configured site.

## Verification

Run the automated tests and build:

```sh
npm test
npm run build
```

The HTTP integration tests start disposable hosts and use temporary project storage. They exercise HTTP failures, malformed JSON/images, timeouts, size limits, fresh request IDs, failed/cancelled batch cleanup, retries, preserved player selection, token duplicate prevention, and artwork persistence through campaign ZIP export/import.

To compare against an installed 5etools source tree with images:

```sh
node scripts/verify-5etools-source.mjs /path/to/5etools
```

The optional audit checks every catalog map and declared token path, and compares copied monsters' imported quick stats against the installed source's own copier. It executes code from that source tree; use your trusted installation. No upstream code, artwork or game content is bundled into Tableforge.

Verified with local 5etools v2.38.0: 126 books, 2,263 maps, 4,574 monsters, and 1,144 copied monsters, with no asset-path or quick-stat mismatches. Browser checks used isolated campaign storage: all 16 Lost Mine of Phandelver maps, a separate Cragmaw Hideout player-map import, Amber Golem search/save/placement and reload, a Goblin WebP asset upload, and repeated failures followed by successful recovery. These counts describe the tested source snapshot; future source versions can be checked with the same script.

All 47 automated tests and the production web build passed. An unsigned macOS arm64 package was also built, and its bundled Electron 28.3.3 server fetched the local catalog, imported a map, and saved token artwork. The server enables IPv4/IPv6 fallback so `localhost` works when the source listens only on `127.0.0.1`. Windows and macOS Intel packages were not run in this audit.
