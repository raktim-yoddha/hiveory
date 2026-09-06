# Security Policy

Please do not disclose suspected vulnerabilities in public issues. Report them privately to the project maintainers with reproduction steps, impact, and any mitigation you have identified.

Privileged capabilities remain in Rust. The renderer receives typed projections and cannot directly access the filesystem, shell, SQLite database, provider network, or secret store. See the maintained [threat model](docs/security/threat-model.md) for current workspace, terminal, browser, plugin, automation, provider, backup, and recovery boundaries.
