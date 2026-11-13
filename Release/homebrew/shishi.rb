# Homebrew cask template for Shishi. It becomes usable once a release publishes Shishi-<version>-macOS-arm64.zip.
# To publish: fill in version and sha256 from that release, then add this file to a tap, for example
# github.com/shen25308/homebrew-tap as Casks/shishi.rb. Users then run:
#   brew install --cask shen25308/tap/shishi
cask "shishi" do
  version "1.7"
  sha256 "REPLACE_WITH_THE_SHA256_OF_THE_RELEASE_ZIP"

  url "https://github.com/shen25308/small-tool/releases/download/v#{version}/Shishi-#{version}-macOS-arm64.zip"
  name "Shishi"
  desc "Task list and quiet inbox for results from Claude Code, Codex and other agents"
  homepage "https://github.com/shen25308/small-tool"

  depends_on arch: :arm64
  depends_on macos: ">= :tahoe"

  app "Shishi.app"

  # Removes only Shishi's own data. Claude Code hooks are removed from Connections before uninstalling.
  zap trash: [
    "~/Library/Application Support/ShiShiDesk",
    "~/Library/Preferences/local.shishi.workdesk.plist",
  ]

  caveats <<~EOS
    Shishi is ad-hoc signed and not notarized yet, so macOS asks you to confirm the first launch.
    To remove its Claude Code hooks, choose Disconnect under Connections before uninstalling.
  EOS
end
