#![warn(clippy::all, clippy::pedantic)]

fn main() -> anyhow::Result<()> {
    t3code_contracts::export::export_bindings()
}
