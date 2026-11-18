{
  description = "Dynamic Music Pill – GNOME Shell Extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;

        version =
          if self ? rev then
            self.rev
          else
            self.dirtyRev;

        mkExtension =
          {
            pname,
            src,
            uuid ? "dynamic-music-pill@andbal",
          }:
          pkgs.stdenvNoCC.mkDerivation {
            inherit pname version src;

            nativeBuildInputs = [
              pkgs.glib
              pkgs.gettext
            ];

            installPhase = ''
              runHook preInstall

              extDir="$out/share/gnome-shell/extensions/${uuid}"
              mkdir -p "$extDir"

              # Copy top-level files (only if they exist).
              for f in metadata.json extension.js prefs.js stylesheet.css; do
                [ -f "$f" ] && cp "$f" "$extDir/"
              done

              # Copy source tree.
              cp -r src "$extDir/"

              # Compile GSettings schemas if present.
              if [ -d schemas ]; then
                cp -r schemas "$extDir/"
                glib-compile-schemas "$extDir/schemas"
              fi

              # Build locale tree from po/ if available (authoritative).
              if [ -d po ]; then
                mkdir -p "$extDir/locale"
                for po_file in po/*.po; do
                  [ -e "$po_file" ] || continue
                  lang="$(basename "$po_file" .po)"
                  mkdir -p "$extDir/locale/$lang/LC_MESSAGES"
                  msgfmt "$po_file" -o "$extDir/locale/$lang/LC_MESSAGES/dynamic-music-pill.mo"
                done
              elif [ -d locale ]; then
                # Fall back to pre-compiled locale tree.
                cp -r locale "$extDir/"
              fi

              runHook postInstall
            '';

            meta = {
              description = "An elegant, pill-shaped music player for GNOME Shell";
              homepage = "https://github.com/Andbal23/dynamic-music-pill";
              license = lib.licenses.gpl3Plus;
              platforms = lib.platforms.linux;
              maintainers = [ ];
            };
          };

        mkSource =
          srcRoot:
          lib.cleanSourceWith {
            src = srcRoot;
            filter =
              path: type:
              let
                rel = lib.removePrefix (toString srcRoot + "/") (toString path);
              in
              rel == ""
              || builtins.elem rel [
                "metadata.json"
                "extension.js"
                "prefs.js"
                "stylesheet.css"
                "LICENSE"
                "src"
                "schemas"
                "locale"
                "po"
              ]
              || lib.hasPrefix "src/" rel
              || lib.hasPrefix "schemas/" rel
              || lib.hasPrefix "locale/" rel
              || lib.hasPrefix "po/" rel;
          };

        defaultSrc = mkSource ./.;
      in
      {
        packages = {
          default = mkExtension {
            pname = "gnome-shell-extension-dynamic-music-pill";
            src = defaultSrc;
          };
        };

        checks = {
          default = self.packages.${system}.default;
        };
      }
    )
    // {
      overlays.default = final: prev: {
        gnome-shell-extension-dynamic-music-pill = self.packages.${final.system}.default;
      };

      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.dynamic-music-pill;
        in
        {
          options.programs.dynamic-music-pill.enable = lib.mkEnableOption "Dynamic Music Pill GNOME Shell extension";

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [
              self.packages.${pkgs.system}.default
            ];
          };
        };
    };
}
