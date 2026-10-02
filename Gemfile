source "https://rubygems.org"

# Pinned so the local build matches GitHub Pages' native build. Without this
# the site compiles against whatever Jekyll happens to be on the machine,
# which is how the legacy @import/deprecated-division Sass in this repo got
# there in the first place.
gem "jekyll", "~> 4.3"

# Ruby 3.4 dropped several stdlib gems out of the default bundle, and Jekyll
# requires them transitively (jekyll/commands/new -> erb).
gem "erb"
gem "csv"
gem "base64"
gem "bigdecimal"

# Jekyll 4 ships sassc via jekyll-sass-converter 2.x, which compiles the
# module system (@use/@forward) used throughout _sass/.
gem "webrick", "~> 1.8"
