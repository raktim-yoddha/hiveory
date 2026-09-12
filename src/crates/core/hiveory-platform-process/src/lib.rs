//! Platform process-launch policy for background work.

use std::process::Command;

/// Configures a child that communicates through pipes rather than a visible terminal.
pub fn configure_background_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // Console-subsystem CLIs otherwise create a transient window from a GUI host.
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    #[cfg(not(windows))]
    let _ = command;
}
