use std::path::Path;

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;
#[cfg(target_os = "macos")]
use core_foundation::data::CFData;
#[cfg(target_os = "macos")]
use core_foundation::url::CFURL;
#[cfg(target_os = "macos")]
use core_foundation_sys::base::{kCFAllocatorDefault, Boolean};
use core_foundation_sys::error::CFErrorRef;
#[cfg(target_os = "macos")]
use core_foundation_sys::url::{
    kCFURLBookmarkCreationWithSecurityScope, kCFURLBookmarkResolutionWithSecurityScope,
    CFURLBookmarkCreationOptions, CFURLBookmarkResolutionOptions,
    CFURLCreateBookmarkData, CFURLCreateByResolvingBookmarkData,
    CFURLStartAccessingSecurityScopedResource, CFURLStopAccessingSecurityScopedResource,
};

pub struct ScopedURL {
    #[cfg(target_os = "macos")]
    url: CFURL,
}

#[cfg(target_os = "macos")]
impl Drop for ScopedURL {
    fn drop(&mut self) {
        unsafe {
            CFURLStopAccessingSecurityScopedResource(self.url.as_concrete_TypeRef());
        }
    }
}

/// Create an app-scope security-scoped bookmark for the given path.
/// On non-macOS platforms this is a no-op.
pub fn create_bookmark(path: &str) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        let is_dir = Path::new(path).is_dir();
        let url = CFURL::from_path(path, is_dir)
            .ok_or_else(|| format!("invalid path: {}", path))?;

        let options: CFURLBookmarkCreationOptions = kCFURLBookmarkCreationWithSecurityScope;
        let mut error: CFErrorRef = std::ptr::null_mut();
        let data_ref = unsafe {
            CFURLCreateBookmarkData(
                kCFAllocatorDefault,
                url.as_concrete_TypeRef(),
                options,
                std::ptr::null(),
                std::ptr::null(),
                &mut error,
            )
        };
        if data_ref.is_null() {
            return Err(format!("failed to create bookmark for {}", path));
        }
        let data = unsafe { CFData::wrap_under_create_rule(data_ref) };
        Ok(data.bytes().to_vec())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(vec![])
    }
}

/// Resolve a security-scoped bookmark and begin accessing the resource.
/// The access is revoked when the returned ScopedURL is dropped.
pub fn resolve_bookmark(data: &[u8]) -> Result<ScopedURL, String> {
    #[cfg(target_os = "macos")]
    {
        if data.is_empty() {
            return Err("empty bookmark data".to_string());
        }

        let cf_data = CFData::from_buffer(data);
        let mut is_stale: Boolean = 0;
        let options: CFURLBookmarkResolutionOptions = kCFURLBookmarkResolutionWithSecurityScope;
        let url_ref = unsafe {
            CFURLCreateByResolvingBookmarkData(
                kCFAllocatorDefault,
                cf_data.as_concrete_TypeRef(),
                options,
                std::ptr::null(),
                std::ptr::null(),
                &mut is_stale,
                std::ptr::null_mut(),
            )
        };
        if url_ref.is_null() {
            return Err("failed to resolve bookmark".to_string());
        }
        let url = unsafe { CFURL::wrap_under_create_rule(url_ref) };

        // start_accessing_security_scoped_resource returns false if the resource
        // is already accessible or if the request failed. We still proceed because
        // the path may be reachable through another active scope.
        unsafe {
            CFURLStartAccessingSecurityScopedResource(url.as_concrete_TypeRef());
        }

        Ok(ScopedURL { url })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = data;
        Ok(ScopedURL {})
    }
}
