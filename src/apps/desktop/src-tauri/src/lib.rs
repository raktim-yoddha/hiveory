#![allow(clippy::result_large_err)]

//! Stable public facade for the desktop application host.
//!
//! The implementation lives under `application/` so native commands and
//! lifecycle code can be split by responsibility without changing the crate's
//! public entry point.

mod application;

pub use application::run;
