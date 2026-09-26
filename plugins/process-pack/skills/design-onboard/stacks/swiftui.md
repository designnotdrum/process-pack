# Stack reference: SwiftUI

Covers iOS, iPadOS, and macOS apps built with SwiftUI, including ones that still use UIKit or AppKit views.

## How to detect it

The `swiftui` entry in `stacks.json`: a `Package.swift`, `*.xcodeproj`, or `*.xcworkspace` at the root.

UI files are the entry's `ui_globs`: Swift sources and everything inside an asset catalog (`**/*.xcassets/**`).

## Where tokens go

Two places, used together:

- **Asset catalog colors.** One named color set per token in the app's `Assets.xcassets`, each with an "Any" value and a "Dark" value. Group them in folders (`Text/`, `Surface/`, `Status/`). Names say the job (`TextPrimary`, `SurfaceRaised`, `StatusDanger`), never the hue.
- **A theme type.** One Swift file that exposes each color once, so views never spell a color name as a string:

  ```swift
  enum Theme {
      static let textPrimary = Color("TextPrimary")
      static let surfaceRaised = Color("SurfaceRaised")
  }
  ```

Type scale and spacing from DESIGN.md go in the same theme type as static values.

## What blocks hardcoded colors

`swiftlint.design.yml` from this skill's `assets/swiftui/`. It is a SwiftLint custom rule, `no_color_literals`, that fails on `Color(red:`, `Color(.sRGB`, `Color(hue:`, `Color(white:`, `Color(hex:`, `UIColor(red:`, `NSColor(red:`, and `#colorLiteral`. It allows `Color("Name")` and system colors such as `Color.accentColor`.

1. Merge its `custom_rules` block into the repo's `.swiftlint.yml`.
2. Make sure SwiftLint runs in the build (a build phase or the SwiftLint build tool plugin) and in CI.
3. The theme type is the only place allowed to name a color; if it needs a literal for a third-party brand mark, add `// swiftlint:disable:next no_color_literals` with the reason.

The rule's pattern was tested with Python's regular expressions against seven literal forms and two allowed forms. SwiftLint uses NSRegularExpression; the pattern uses nothing that differs between the two (unverified against SwiftLint itself, which is not installed on the laptop).

## How contrast is checked

`asset_catalog_contrast.py` from `assets/swiftui/`. It reads every color set in the catalog, and checks each pair in both the "Any" and "Dark" appearances. A color with no dark variant uses its "Any" value in dark mode.

1. Copy it to the repo's `scripts/`.
2. Write `.process/contrast-pairs.json` with color set names: `[{"fg": "TextPrimary", "bg": "SurfaceRaised", "min": 4.5}]`. Use 4.5 for text, and 3 for large text and icons.
3. Run it in CI: `python3 scripts/asset_catalog_contrast.py App/Assets.xcassets --pairs .process/contrast-pairs.json`. It exits 1 on any failing pair and prints the ratio for each.

Colors with alpha below 1 are refused, because their contrast depends on what is behind them.
