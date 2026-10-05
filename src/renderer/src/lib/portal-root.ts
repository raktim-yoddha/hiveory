/**
 * Where a floating layer (menu, popover, listbox) is portaled. Inside a modal
 * <dialog> it must live in the dialog: everything outside it is inert and sits
 * below the top layer.
 */
export const portalRoot = (anchor: Element | null): Element => anchor?.closest('dialog') ?? document.body
