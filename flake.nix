{
  description = "T3 Code - A harness for coding agents";

  inputs = {
    # Pinned to stable to avoid breaking changes
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
    
    # Track upstream repo - run `nix flake update` to check for changes
    t3code-src = {
      url = "github:pingdotgg/t3code";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, t3code-src }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
    in
    {
      packages = builtins.listToAttrs (
        map (system:
          let
            pkgs = import nixpkgs { inherit system; };
            
            # Get version from upstream commit
            version = t3code-src.shortRev or "latest";
            
            t3codeDerivation = pkgs.stdenv.mkDerivation {
              pname = "t3code";
              inherit version;

              # Use latest release from GitHub - update hash when release changes
              src = pkgs.fetchurl {
                url = "https://github.com/pingdotgg/t3code/releases/download/v0.0.23/T3-Code-0.0.23-x86_64.AppImage";
                sha256 = "sha256-qMPSxQuiCwLT0As1foSDqaKoNMoLrjbKbDSwQW56T7g=";
              };

              # Build dependencies for appimage-run
              nativeBuildInputs = with pkgs; [
                appimage-run
              ];

              # Don't strip - AppImages are ELF with appended squashfs
              dontStrip = true;
              dontBuild = true;
              dontConfigure = true;
              dontUnpack = true;

              installPhase = ''
                mkdir -p $out
                # Extract AppImage to $out
                appimage-run -x $out $src
              '';

              meta = {
                description = "T3 Code - A harness for coding agents";
                homepage = "https://t3.codes";
                license = pkgs.lib.licenses.mit;
                platforms = [ "x86_64-linux" "aarch64-linux" ];
              };
            };
          in
          lib.nameValuePair system t3codeDerivation
        ) systems
      );
    };
}